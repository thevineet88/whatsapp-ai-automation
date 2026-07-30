import type { MessageUnderstanding, UnderstoodIntent } from "@/lib/core/understanding";
import type { Db } from "@/lib/db/client";
import { packages } from "@/lib/db/schema";
import {
  type EscalationSeverity,
  resolveEscalation,
  severityFor,
  validateCandidateIds,
  validatePackageId,
} from "@/lib/guardrails/escalationPolicy";
import type { AnswerGenerator } from "@/lib/llm/answerModel";
import type { CollectorExtractor } from "@/lib/llm/collectorExtractor";
import { generateKnowledgeAnswer } from "@/lib/llm/generateAnswer";
import type { UnderstandingClassifier, UnderstandingOutput } from "@/lib/llm/understanding";
import type { Embedder } from "@/lib/rag/embedder";
import { listBatches } from "@/lib/tools/packages";
import { getPaymentSchedule, getPrice } from "@/lib/tools/pricing";
import { eq } from "drizzle-orm";
import { type Catalogue, type CatalogueEntry, loadCatalogue } from "./catalogue";
import {
  type CollectorData,
  type CollectorPhase,
  buildCollectorAskAll,
  buildCollectorSummary,
  buildHandoffTravelerMessage,
  extractCollectorFields,
} from "./collector";
import { classifyEscalationKeywords, classifyIntent, classifyKnownIntent } from "./intent";
import { matchPackages } from "./packageMatch";
import {
  GREETING_REPLY,
  HOW_TO_BOOK_REPLY,
  batchesReply,
  browsePackagesReply,
  cancellationPolicyReply,
  clarifyBetweenCandidatesReply,
  clarifyPackageReply,
  departurePointReply,
  durationReply,
  escalationReply,
  inclusionsExclusionsReply,
  installmentsReply,
  itineraryReply,
  noPaymentScheduleReply,
  noUpcomingBatchesReply,
  notSupportedReply,
  packageOverviewReply,
  priceReply,
} from "./replies";

const CLARIFICATION_LIMIT = 3;

export type RagDeps = {
  embedder: Embedder;
  answerGenerator: AnswerGenerator;
  understandingClassifier: UnderstandingClassifier;
  collectorExtractor?: CollectorExtractor;
};

export type ConversationStatus = "open" | "escalated" | "awaiting_human" | "human_active";

export type ConversationRouteState = {
  packageId: string | null;
  pendingClarificationCount: number;
  status: ConversationStatus;
  // Collector phase. Null means normal Q&A mode.
  phase: string | null;
  // Structured data collected during the collector phase.
  collectorData: Record<string, unknown> | null;
  // Oldest first. Gives the understanding pass enough context to resolve
  // follow ups like "and how much is it?" against the trip already in play.
  history: { role: "traveller" | "bot"; content: string }[];
};

export type RouteResult = {
  replyText: string | null;
  nextPackageId: string | null;
  nextPendingClarificationCount: number;
  // Set by the collector flow; null means no phase change.
  nextPhase: string | null;
  // Updated collector data to persist alongside the phase.
  nextCollectorData: Record<string, unknown> | null;
  // Set by the collector flow when the traveller's structured summary
  // should be attached to the escalation row, so the admin sees what was
  // captured at handoff.
  escalateDetail: string | null;
  escalateReason: string | null;
  escalateSeverity: EscalationSeverity | null;
  sourceChunkIds: string[] | null;
  // Optional trace data. Populated by the router as it runs; the worker
  // reads it after routeMessage returns and writes a message_traces row.
  // Optional and additive so tests that don't care about tracing don't need
  // any changes.
  trace?: RouteTraceData;
};

// Snapshot of trace-relevant data captured during one call to routeMessage.
// Kept deliberately narrow: every field here is one the worker needs to
// build a message_traces row.
export type RouteTraceData = {
  intent: string;
  toolCalls: { name: string; input: unknown; output: unknown }[];
  retrievedChunkIds: string[];
  retrievalTopScore: number | null;
  llmUsage: {
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
  } | null;
};

function noReply(state: ConversationRouteState): RouteResult {
  return {
    replyText: null,
    nextPackageId: state.packageId,
    nextPendingClarificationCount: state.pendingClarificationCount,
    nextPhase: state.phase,
    nextCollectorData: state.collectorData,
    escalateReason: null,
    escalateSeverity: null,
    escalateDetail: null,
    sourceChunkIds: null,
  };
}

export async function routeMessage(
  db: Db,
  tenantId: string,
  state: ConversationRouteState,
  holdingReplyMessage: string,
  text: string,
  rag: RagDeps,
): Promise<RouteResult> {
  // A teammate is actively in the thread: stay quiet so the bot never talks
  // over them. This is the only state that silences replies, and nothing
  // sets it automatically, so a raised escalation alone no longer strands
  // the traveller.
  if (state.status === "human_active") {
    return noReply(state);
  }

  const catalogue = await loadCatalogue(db, tenantId);

  // Trace accumulator. Mutable, captured by the inner functions so they can
  // record what they actually did (which tool they invoked, what chunks
  // they got back, etc) without each of them needing to return it. The
  // worker reads `trace` from the final RouteResult.
  const trace: RouteTraceData = {
    intent: "human_takeover",
    toolCalls: [],
    retrievedChunkIds: [],
    retrievalTopScore: null,
    llmUsage: null,
  };

  // Collector intent check BEFORE the keyword pre-gate. The pre-gate's
  // `booking_or_payment` list fires on "i want to book", but that is also
  // the exact phrase that should start the booking collector flow
  // (which itself escalates to reason=booking_request with a structured
  // summary). The collector is the right handler for booking AND custom-
  // package requests, so it claims those messages first; only true
  // safety risks (fitness, complaint, explicit human request, refund)
  // still go through the pre-gate.
  //
  // The understanding pass runs first (when no keyword escalation) so
  // the LLM's intent can claim collector routing on phrasings that the
  // keyword list misses — "kedarnath trip book", "book Kedarnath" —
  // which otherwise fall through to a generic booking_or_payment
  // escalation reply with no form sent.
  const keywordReason = classifyEscalationKeywords(text);

  let understanding: MessageUnderstanding | null = null;
  let understandingOutput: UnderstandingOutput | null = null;
  if (!keywordReason) {
    try {
      understandingOutput = await rag.understandingClassifier({
        message: text,
        history: state.history,
        anchoredPackageId: state.packageId,
        catalogue,
      });
      understanding = understandingOutput.understanding;
      trace.llmUsage = understandingOutput.usage;
    } catch (error) {
      console.error("routeMessage: understanding classifier failed", {
        tenantId,
        error,
      });
    }
  }

  let collectorIntent: CollectorIntent | null = null;
  if (state.phase) {
    collectorIntent =
      state.phase === "collecting_custom_package" ? "custom_package_request" : "booking_request";
  } else {
    // Keyword check first: deterministic and cheap. Falls back to the
    // LLM's intent so phrasings the keyword list misses still reach the
    // collector instead of a generic escalation reply.
    const known = classifyKnownIntent(text);
    if (known && (known.type === "custom_package_request" || known.type === "booking_request")) {
      collectorIntent = known.type;
    } else if (
      understanding &&
      (understanding.intent === "custom_package_request" ||
        understanding.intent === "booking_request")
    ) {
      // Safety net: the LLM can still misclassify a bare trip name
      // ("kedarnath trip") as booking_request. Only trust the LLM's
      // booking_request when the message itself has a clear booking verb
      // OR a trip is already anchored (so the user is following up on a
      // previously discussed trip).
      if (understanding.intent === "booking_request" && !hasBookingVerb(text) && !state.packageId) {
        // Fall through: this is a trip overview, not a booking request.
      } else {
        collectorIntent = understanding.intent;
      }
    }
  }

  if (collectorIntent) {
    return withTrace(
      await runCollector({
        db,
        tenantId,
        state,
        intent: collectorIntent,
        text,
        catalogue,
        understanding,
        collectorExtractor: rag.collectorExtractor,
      }),
      { ...trace, intent: collectorIntent },
    );
  }

  const escalation = resolveEscalation(keywordReason, understanding);
  if (escalation) {
    return withTrace(
      {
        replyText: escalationReply(escalation.reason, holdingReplyMessage),
        nextPackageId:
          validatePackageId(understanding?.packageId ?? null, catalogue) ?? state.packageId,
        nextPendingClarificationCount: 0,
        nextPhase: state.phase,
        nextCollectorData: state.collectorData,
        escalateReason: escalation.reason,
        escalateSeverity: escalation.severity,
        escalateDetail: null,
        sourceChunkIds: null,
      },
      { ...trace, intent: escalation.reason },
    );
  }

  // The classifier is down. Fall back to the deterministic keyword router so
  // the traveller still gets a real answer rather than a holding reply.
  if (!understanding) {
    return withTrace(
      await routeWithKeywordFallback(
        db,
        tenantId,
        state,
        holdingReplyMessage,
        text,
        rag,
        catalogue,
        trace,
      ),
      {
        ...trace,
        intent: keywordReason ? "keyword_escalation" : "keyword_fallback",
      },
    );
  }

  const resolvedPackageId = validatePackageId(understanding.packageId, catalogue);
  const candidateIds = validateCandidateIds(understanding.packageCandidateIds, catalogue);

  // The model is told to carry the anchored trip through follow ups, so a
  // returned id that equals the existing anchor may be a genuine resolution
  // or just that echo. The deterministic matcher is the tiebreaker: it only
  // fires on words actually present in this message.
  const namedInThisMessage = singleDeterministicMatch(text, catalogue);
  const anchorFromThisMessage = Boolean(
    namedInThisMessage ?? (resolvedPackageId && resolvedPackageId !== state.packageId),
  );

  // A named-but-unrecognized place overrides intent-based carryover
  // entirely. "price of Nashik trip" has intent=price, which normally
  // carries the anchor forward for a genuine follow up ("and the price for
  // that one") - but here a specific, wrong place was named, and answering
  // with whatever trip was last discussed would quote a price for a trip
  // nobody asked about.
  const allowCarryover =
    carriesOverAnchor(understanding.intent) && !understanding.namedUnrecognizedPlace;

  const anchored =
    catalogue.find((entry) => entry.id === resolvedPackageId) ??
    namedInThisMessage ??
    (allowCarryover ? catalogue.find((entry) => entry.id === state.packageId) : null) ??
    null;

  // If the anchored package's itinerary mentions a place that appears in
  // this message, treat the message as an itinerary question so the
  // traveller gets the relevant day's detail rather than a knowledge-base
  // miss. "Apsarkonda Waterfall?" when Gokarna is anchored returns the
  // itinerary, not a generic handoff.
  // Skips override when the message is shaped like a real question with
  // question words — those should reach RAG even if a place name is in
  // the query ("do I need a permit for Nathula?"). And skips tool intents
  // (price, batches, etc.) that already produce the right answer.
  if (anchored && !understanding.namedUnrecognizedPlace) {
    const OVERRIDEABLE = new Set<UnderstoodIntent>(["general_knowledge", "best_season", "other"]);
    if (OVERRIDEABLE.has(understanding.intent) && !looksLikeRealQuestion(text)) {
      const itineraryPlaces = extractItineraryPlaces(anchored);
      if (itineraryPlaces.some((place) => text.toLowerCase().includes(place.toLowerCase()))) {
        understanding = { ...understanding, intent: "itinerary" };
      }
    }
  }

  // Transport-mode questions ("train name?", "which train?") that the
  // model classified as something else (often "other") should resolve to
  // departure_point so the anchored package's travel detail gets surfaced.
  // Tool intents already answer the question correctly, so only override
  // when the original intent would otherwise fall through.
  const NON_TOOL_INTENTS = new Set<UnderstoodIntent>(["general_knowledge", "best_season", "other"]);
  if (
    anchored &&
    NON_TOOL_INTENTS.has(understanding.intent) &&
    !understanding.namedUnrecognizedPlace
  ) {
    if (transportKeywordsHit(text)) {
      understanding = { ...understanding, intent: "departure_point" };
    }
  }

  trace.intent = understanding.intent;
  const outcome = await buildReply({
    db,
    tenantId,
    rag,
    catalogue,
    intent: understanding.intent,
    secondaryIntent: understanding.secondaryIntent,
    anchored,
    anchorFromThisMessage,
    namedUnrecognizedPlace: understanding.namedUnrecognizedPlace,
    candidateIds,
    state,
    text,
    holdingReplyMessage,
    trace,
  });

  return outcome;
}

function withTrace(result: RouteResult, trace: RouteTraceData): RouteResult {
  return { ...result, trace };
}

// package_overview and browse_packages are how a traveller names a specific
// trip ("Nashik trip?", "Dubai?"). If that name doesn't resolve to anything
// in the catalogue, the right answer is "we don't have that", not silently
// substituting whatever trip was last discussed - Samyati doesn't run trips
// to Nashik or Dubai, and answering with Sikkim's price for either is worse
// than not answering at all. Intents that ask something ABOUT the current
// trip without naming a new one ("and the price for that one") are the only
// ones that should carry the anchor forward.
const ANCHOR_CARRYOVER_INTENTS = new Set<UnderstoodIntent>([
  "batches",
  "price",
  "inclusions_exclusions",
  "itinerary",
  "best_season",
  "departure_point",
  "duration",
  "installments",
  "cancellation_policy",
  "general_knowledge",
  "other",
]);

function carriesOverAnchor(intent: UnderstoodIntent): boolean {
  return ANCHOR_CARRYOVER_INTENTS.has(intent);
}

// Pulls candidate place names from the package's pre-extracted places list
// (lifted from itinerary day titles). Used by the route so a traveller
// asking about a specific stop can be matched to the package that covers it,
// even when the model marks the message as low-confidence or off-topic for
// retrieval. "Apsarkonda Waterfall?" when Gokarna is anchored returns the
// itinerary, not a generic handoff.
function extractItineraryPlaces(pkg: CatalogueEntry): string[] {
  return pkg.places;
}

// Deterministic check for transport-mode questions that the model often
// classifies incorrectly. Mirrors the keyword list in intent.ts so the
// route-level override stays in sync with the keyword router.
function transportKeywordsHit(text: string): boolean {
  const transportKeywords = [
    "train name",
    "which train",
    "train number",
    "train no",
    "bus number",
    "flight name",
    "which flight",
    "travel mode",
    "by which train",
    "train ka naam",
    "kon si train",
  ];
  return transportKeywords.some((kw) => text.toLowerCase().includes(kw));
}

// True when the message is shaped like a real question rather than a bare
// noun. Used to decide whether to route to the knowledge base vs. the
// anchored itinerary. A bare place name ("Apsarkonda Waterfall?") should
// surface the itinerary day; a real question with a place in it ("do I
// need a permit for Nathula?") should still reach RAG.
function looksLikeRealQuestion(text: string): boolean {
  const questionWords =
    /\b(what|how|why|when|where|which|do|does|did|is|are|can|could|should|will|would)\b/i;
  return questionWords.test(text);
}

// Only commits when exactly one package matches: an ambiguous term must
// still reach a clarifying question rather than silently pick a trip.
function singleDeterministicMatch(text: string, catalogue: Catalogue): CatalogueEntry | null {
  const { matched } = matchPackages(text, catalogue);
  return matched.length === 1 ? matched[0] : null;
}

// True when the message contains a clear booking verb. Used to separate
// "kedarnath trip" (package_overview) from "I want to book kedarnath"
// (booking_request). The keyword pre-gate already covers most booking
// phrasings; this is a backstop for LLM classifications that over-match.
const BOOKING_VERBS =
  /\b(book|reserve|register|sign\s*up|confirm\s+(?:my\s+)?(?:seat|booking)|lock\s+(?:my\s+)?seat|pay\s+(?:the\s+)?(?:first\s+)?(?:installment|advance))\b/i;

function hasBookingVerb(text: string): boolean {
  return BOOKING_VERBS.test(text);
}

// Prefixed onto a real answer when the trip it's about wasn't named in this
// message but carried over from earlier in the conversation ("tell me about
// the hotels" after "Kerala trip?" two messages back). Makes clear which
// trip is being described without the traveller having to repeat it, and is
// only applied to genuine informational answers, never to greetings,
// catalogue listings, clarifying questions, or escalation/holding replies.
function withAnchorContext(
  text: string,
  anchorFromThisMessage: boolean,
  anchoredName: string,
): string {
  return anchorFromThisMessage
    ? text
    : `Since you mentioned ${anchoredName} earlier, here's the info:\n\n${text}`;
}

type BuildReplyInput = {
  db: Db;
  tenantId: string;
  rag: RagDeps;
  catalogue: Catalogue;
  intent: UnderstoodIntent;
  secondaryIntent: UnderstoodIntent | null;
  anchored: CatalogueEntry | null;
  // True when the trip was identified from this message rather than carried
  // over from earlier in the conversation.
  anchorFromThisMessage: boolean;
  namedUnrecognizedPlace: boolean;
  candidateIds: string[];
  state: ConversationRouteState;
  text: string;
  holdingReplyMessage: string;
  // Shared mutable trace accumulator. Populated by answerFromKnowledge and
  // runAnchoredIntent as they actually do work, then attached to the final
  // RouteResult for the worker to persist.
  trace: RouteTraceData;
};

async function buildReply(input: BuildReplyInput): Promise<RouteResult> {
  const { db, tenantId, rag, catalogue, intent, anchored, candidateIds, state, text, trace } =
    input;

  const keep = (replyText: string | null, extra?: Partial<RouteResult>): RouteResult => {
    const result: RouteResult = {
      replyText,
      nextPackageId: anchored?.id ?? state.packageId,
      nextPendingClarificationCount: 0,
      nextPhase: state.phase,
      nextCollectorData: state.collectorData,
      escalateReason: null,
      escalateSeverity: null,
      escalateDetail: null,
      sourceChunkIds: null,
      ...extra,
    };
    return withTrace(result, trace);
  };

  if (intent === "greeting") {
    return keep(GREETING_REPLY);
  }

  // When we already know the package (from this message or from conversation
  // history), treat "browse_packages" as a package overview rather than
  // dumping the full catalogue. The catalogue listing is only for genuinely
  // unknown requests like "what trips do you have?".
  if (intent === "browse_packages" && !anchored) {
    return keep(browsePackagesReply(catalogue), { nextPackageId: state.packageId });
  }

  if (intent === "how_to_book") {
    return keep(HOW_TO_BOOK_REPLY);
  }

  // A named-but-unrecognized place with no anchor to fall back on: tell the
  // traveller we don't offer that destination and show what we do offer.
  // "How much for a trip to Dubai" should get "we don't run that, here's
  // what we do", not a search over Kedarnath permits, and not a clarification
  // prompt that burns a turn.
  if (input.namedUnrecognizedPlace && !anchored) {
    return keep(notSupportedReply(catalogue));
  }

  // Knowledge-base questions work with or without an anchor: retrieval is
  // simply narrowed to the trip when we have one.
  if (intent === "general_knowledge" || intent === "other" || intent === "best_season") {
    return answerFromKnowledge(input);
  }

  if (!anchored) {
    return clarify(input);
  }

  return runAnchoredIntent(input);
}

async function clarify(input: BuildReplyInput): Promise<RouteResult> {
  const { catalogue, candidateIds, state } = input;

  // Prefer naming the trips the message pointed at over listing the lot.
  const named = candidateIds
    .map((id) => catalogue.find((entry) => entry.id === id))
    .filter((entry): entry is CatalogueEntry => entry !== undefined);

  const nextCount = state.pendingClarificationCount + 1;
  if (nextCount >= CLARIFICATION_LIMIT) {
    return {
      replyText: escalationReply("clarification_limit_reached", input.holdingReplyMessage),
      nextPackageId: null,
      nextPendingClarificationCount: nextCount,
      nextPhase: state.phase,
      nextCollectorData: state.collectorData,
      escalateReason: "clarification_limit_reached",
      escalateSeverity: severityFor("clarification_limit_reached"),
      escalateDetail: null,
      sourceChunkIds: null,
    };
  }

  return {
    replyText:
      named.length > 1 ? clarifyBetweenCandidatesReply(named) : clarifyPackageReply(catalogue),
    nextPackageId: state.packageId,
    nextPendingClarificationCount: nextCount,
    nextPhase: state.phase,
    nextCollectorData: state.collectorData,
    escalateReason: null,
    escalateSeverity: null,
    escalateDetail: null,
    sourceChunkIds: null,
  };
}

async function runAnchoredIntent(input: BuildReplyInput): Promise<RouteResult> {
  const {
    db,
    tenantId,
    intent,
    anchored,
    trace,
    holdingReplyMessage,
    anchorFromThisMessage,
    state,
  } = input;
  if (!anchored) {
    throw new Error("runAnchoredIntent called without an anchored package");
  }

  const prefixed = (text: string) => withAnchorContext(text, anchorFromThisMessage, anchored.name);

  try {
    const outcome = await runToolIntent(db, tenantId, anchored, asToolIntent(intent));

    // Record what we actually did so the trace has a faithful log.
    trace.toolCalls.push({ name: intent, input: { packageId: anchored.id }, output: outcome });

    // A single message often carries two questions ("when is it, and how
    // much?"). Answering one and ignoring the other reads as not listening.
    const secondary = input.secondaryIntent;
    if (secondary && secondary !== intent && isToolIntent(secondary) && !outcome.escalateReason) {
      try {
        const extra = await runToolIntent(db, tenantId, anchored, secondary);
        trace.toolCalls.push({ name: secondary, input: { packageId: anchored.id }, output: extra });
        if (!extra.escalateReason) {
          return withTrace(
            {
              replyText: prefixed(`${outcome.text}\n\n${extra.text}`),
              nextPackageId: anchored.id,
              nextPendingClarificationCount: 0,
              nextPhase: state.phase,
              nextCollectorData: state.collectorData,
              escalateReason: null,
              escalateSeverity: null,
              escalateDetail: null,
              sourceChunkIds: null,
            },
            trace,
          );
        }
      } catch {
        // The primary answer already stands; a failing follow-on question is
        // not a reason to withhold it.
      }
    }

    return withTrace(
      {
        // A soft-escalating outcome (e.g. "no upcoming batches") still names
        // the specific package in its own text, so the prefix still applies;
        // only the generic tool_error holding message below is exempt.
        replyText: prefixed(outcome.text),
        nextPackageId: anchored.id,
        nextPendingClarificationCount: 0,
        nextPhase: state.phase,
        nextCollectorData: state.collectorData,
        escalateReason: outcome.escalateReason,
        escalateSeverity: outcome.escalateReason ? severityFor(outcome.escalateReason) : null,
        escalateDetail: null,
        sourceChunkIds: null,
      },
      trace,
    );
  } catch (error) {
    console.error("routeMessage: tool layer threw", {
      tenantId,
      packageId: anchored.id,
      intent,
      error,
    });
    return withTrace(
      {
        replyText: escalationReply("tool_error", input.holdingReplyMessage),
        nextPackageId: anchored.id,
        nextPendingClarificationCount: 0,
        nextPhase: state.phase,
        nextCollectorData: state.collectorData,
        escalateReason: "tool_error",
        escalateSeverity: severityFor("tool_error"),
        escalateDetail: null,
        sourceChunkIds: null,
      },
      trace,
    );
  }
}

async function answerFromKnowledge(input: BuildReplyInput): Promise<RouteResult> {
  const { db, tenantId, rag, anchored, state, text, holdingReplyMessage, trace } = input;

  try {
    const { result, llmUsage, retrievedChunkIds, retrievalTopScore } =
      await generateKnowledgeAnswer(db, tenantId, rag.embedder, rag.answerGenerator, {
        question: text,
        packageId: anchored?.id ?? null,
        packageName: anchored?.name ?? null,
      });

    // Populate the trace accumulator so the worker sees what the pipeline
    // actually did. Done here, not in generateKnowledgeAnswer, because the
    // router decides what the intent label is.
    trace.retrievedChunkIds = retrievedChunkIds;
    trace.retrievalTopScore = retrievalTopScore;
    trace.llmUsage = llmUsage ?? null;

    if (result.kind === "answered") {
      return withTrace(
        {
          replyText: anchored
            ? withAnchorContext(result.text, input.anchorFromThisMessage, anchored.name)
            : result.text,
          nextPackageId: anchored?.id ?? state.packageId,
          nextPendingClarificationCount: 0,
          nextPhase: state.phase,
          nextCollectorData: state.collectorData,
          escalateReason: null,
          escalateSeverity: null,
          escalateDetail: null,
          sourceChunkIds: result.sourceIds,
        },
        trace,
      );
    }

    return withTrace(
      {
        replyText: escalationReply(result.reason, holdingReplyMessage),
        nextPackageId: anchored?.id ?? state.packageId,
        nextPendingClarificationCount: 0,
        nextPhase: state.phase,
        nextCollectorData: state.collectorData,
        escalateReason: result.reason,
        escalateSeverity: severityFor(result.reason),
        escalateDetail: null,
        sourceChunkIds: null,
      },
      trace,
    );
  } catch (error) {
    console.error("routeMessage: knowledge answer pipeline threw", {
      tenantId,
      packageId: anchored?.id ?? null,
      error,
    });
    return withTrace(
      {
        replyText: escalationReply("tool_error", holdingReplyMessage),
        nextPackageId: anchored?.id ?? state.packageId,
        nextPendingClarificationCount: 0,
        nextPhase: state.phase,
        nextCollectorData: state.collectorData,
        escalateReason: "tool_error",
        escalateSeverity: severityFor("tool_error"),
        escalateDetail: null,
        sourceChunkIds: null,
      },
      trace,
    );
  }
}

type ToolIntent = Extract<
  UnderstoodIntent,
  | "batches"
  | "price"
  | "inclusions_exclusions"
  | "itinerary"
  | "departure_point"
  | "duration"
  | "installments"
  | "cancellation_policy"
  | "package_overview"
  | "browse_packages"
>;

const TOOL_INTENTS = new Set<UnderstoodIntent>([
  "batches",
  "price",
  "inclusions_exclusions",
  "itinerary",
  "departure_point",
  "duration",
  "installments",
  "cancellation_policy",
  "package_overview",
  "browse_packages",
]);

function isToolIntent(intent: UnderstoodIntent): intent is ToolIntent {
  return TOOL_INTENTS.has(intent);
}

// Anything reaching the tool layer with a package resolved but no specific
// question is treated as a request for an overview of that trip.
function asToolIntent(intent: UnderstoodIntent): ToolIntent {
  return isToolIntent(intent) ? intent : "package_overview";
}

type PackageRow = typeof packages.$inferSelect;

// Every value here comes from the database. The understanding pass only
// chose which tool to run and which trip to run it against; it never
// supplies a price, a date or a seat count (invariant 1).
async function runToolIntent(
  db: Db,
  tenantId: string,
  entry: CatalogueEntry,
  intent: ToolIntent,
): Promise<{ text: string; escalateReason: string | null }> {
  const pkg = await loadPackageRow(db, entry.id);

  switch (intent) {
    // Both mean "tell me about this trip" once a package is resolved.
    case "package_overview":
    case "browse_packages": {
      const upcoming = await listBatches(db, tenantId, { packageId: pkg.id });
      return { text: packageOverviewReply(pkg, upcoming), escalateReason: null };
    }
    case "batches": {
      const upcoming = await listBatches(db, tenantId, { packageId: pkg.id });
      if (upcoming.length === 0) {
        return { text: noUpcomingBatchesReply(pkg), escalateReason: "no_upcoming_batches" };
      }
      return { text: batchesReply(pkg, upcoming), escalateReason: null };
    }
    case "price": {
      const upcoming = await listBatches(db, tenantId, { packageId: pkg.id });
      if (upcoming.length === 0) {
        return { text: noUpcomingBatchesReply(pkg), escalateReason: "no_upcoming_batches" };
      }
      const chosen = upcoming.find((b) => !b.isFull) ?? upcoming[0];
      const price = await getPrice(db, tenantId, { batchId: chosen.id });
      if (!price) {
        return { text: noUpcomingBatchesReply(pkg), escalateReason: "no_upcoming_batches" };
      }
      return { text: priceReply(pkg, chosen, price), escalateReason: null };
    }
    case "inclusions_exclusions":
      return { text: inclusionsExclusionsReply(pkg), escalateReason: null };
    case "itinerary":
      return { text: itineraryReply(pkg), escalateReason: null };
    case "departure_point":
      return { text: departurePointReply(pkg), escalateReason: null };
    case "duration":
      return { text: durationReply(pkg), escalateReason: null };
    case "installments": {
      const schedule = await getPaymentSchedule(db, tenantId, { packageId: pkg.id });
      if (schedule.installments.length === 0) {
        return { text: noPaymentScheduleReply(pkg), escalateReason: "no_payment_schedule" };
      }
      return { text: installmentsReply(pkg, schedule), escalateReason: null };
    }
    case "cancellation_policy": {
      const schedule = await getPaymentSchedule(db, tenantId, { packageId: pkg.id });
      if (schedule.cancellationPolicy.length === 0) {
        return { text: noPaymentScheduleReply(pkg), escalateReason: "no_payment_schedule" };
      }
      return { text: cancellationPolicyReply(pkg, schedule), escalateReason: null };
    }
  }
}

async function loadPackageRow(db: Db, packageId: string): Promise<PackageRow> {
  const [row] = await db.select().from(packages).where(eq(packages.id, packageId));
  if (!row) throw new Error(`package not found: ${packageId}`);
  return row;
}

// Degraded path used only when the understanding classifier is unavailable.
// Deliberately the old deterministic behaviour: less capable, but it keeps
// answering instead of handing every message to a person.
async function routeWithKeywordFallback(
  db: Db,
  tenantId: string,
  state: ConversationRouteState,
  holdingReplyMessage: string,
  text: string,
  rag: RagDeps,
  catalogue: Catalogue,
  trace: RouteTraceData,
): Promise<RouteResult> {
  const intent = classifyIntent(text);
  const { matched } = matchPackages(text, catalogue);
  const anchored =
    (matched.length === 1 ? matched[0] : undefined) ??
    catalogue.find((entry) => entry.id === state.packageId) ??
    null;

  const understoodIntent: UnderstoodIntent =
    intent.kind === "known" ? (intent.type as UnderstoodIntent) : "general_knowledge";

  const outcome = await buildReply({
    db,
    tenantId,
    rag,
    catalogue,
    intent: understoodIntent,
    secondaryIntent: null,
    anchored,
    anchorFromThisMessage: matched.length === 1,
    namedUnrecognizedPlace: false,
    candidateIds: matched.map((entry) => entry.id),
    state,
    text,
    holdingReplyMessage,
    trace,
  });

  return withTrace(outcome, trace);
}

// ─── Collector (custom package + booking) ──────────────────────────────────

// Resolves the phrase that should kick off collection. Both the keyword
// pre-gate and the LLM understanding pass can claim it. The phase is
// sticky: once a conversation enters collecting_custom_package or
// collecting_booking, every subsequent message in the same phase stays
// on that flow until the collector itself escalates or the phase is
// cleared by some other system (e.g. an admin returns the thread to
// the bot, which resets the phase).
type CollectorIntent = "custom_package_request" | "booking_request";

function resolveCollectorIntent(
  text: string,
  understanding: MessageUnderstanding | null,
  state: ConversationRouteState,
): CollectorIntent | null {
  // The collector is re-entrant, not single-shot. Every time the
  // traveller asks for a custom package or to book, the collector
  // starts fresh: any prior phase is dropped, and a new escalation
  // entry will be created at the end so the admin sees each request as
  // its own line item rather than one running thread. The earlier
  // "follow up until 50% filled" design made the bot pester travellers
  // for missing fields, which they hated.
  const classified = classifyIntent(text);
  if (
    classified.kind === "known" &&
    (classified.type === "custom_package_request" || classified.type === "booking_request")
  ) {
    return classified.type;
  }
  if (understanding?.intent === "custom_package_request") return "custom_package_request";
  if (understanding?.intent === "booking_request") return "booking_request";
  return null;
}

// Decides what kind of work to do for the next message. Three cases:
//   - Phase null and intent matches → start collection, ask everything
//   - Phase set and matches the resolved intent → parse the reply,
//     send handoff message, escalate with captured data, clear phase.
//     No "still need X, Y, Z" follow-ups; no fill-% gating.
//   - Phase set but a different collector intent → reset, start fresh
//     for the new intent. Each request is its own escalation entry.
async function runCollector(input: {
  db: Db;
  tenantId: string;
  state: ConversationRouteState;
  intent: CollectorIntent;
  text: string;
  catalogue: Catalogue;
  understanding: MessageUnderstanding | null;
  collectorExtractor?: CollectorExtractor;
}): Promise<RouteResult> {
  const { state, intent, text, catalogue, understanding, collectorExtractor } = input;

  const targetPhase: CollectorPhase =
    intent === "custom_package_request" ? "collecting_custom_package" : "collecting_booking";

  // If the phase is set and matches this intent, this is the user's
  // reply to the ask-all. Extract whatever they provided, send the
  // handoff message (which names both what we have and what's missing),
  // escalate with the summary, and clear the phase.
  if (state.phase === targetPhase && state.collectorData) {
    const packageContext =
      intent === "booking_request"
        ? { name: catalogue.find((c) => c.id === state.packageId)?.name ?? null }
        : undefined;
    const updated = await extractCollectorFields(
      targetPhase,
      state.collectorData as CollectorData,
      text,
      packageContext,
      collectorExtractor,
    );
    const summary = buildCollectorSummary(targetPhase, updated);

    return {
      replyText: buildHandoffTravelerMessage(targetPhase, updated),
      nextPackageId: state.packageId,
      nextPendingClarificationCount: 0,
      nextPhase: null,
      nextCollectorData: null,
      escalateReason:
        targetPhase === "collecting_custom_package" ? "custom_package_request" : "booking_request",
      escalateSeverity: "hard",
      escalateDetail: summary,
      sourceChunkIds: null,
    };
  }

  // Fresh request (phase null or a different phase). Ask everything.
  const anchored =
    intent === "booking_request"
      ? (catalogue.find((c) => c.id === state.packageId) ??
        catalogue.find(
          (c) => c.id === validatePackageId(understanding?.packageId ?? null, catalogue),
        ) ??
        null)
      : null;

  const askText = buildCollectorAskAll(targetPhase, anchored?.name ?? undefined);

  return {
    replyText: askText,
    nextPackageId: anchored?.id ?? state.packageId,
    nextPendingClarificationCount: 0,
    nextPhase: targetPhase,
    nextCollectorData: { fields: {} } as unknown as Record<string, unknown>,
    escalateReason: null,
    escalateSeverity: null,
    escalateDetail: null,
    sourceChunkIds: null,
  };
}
