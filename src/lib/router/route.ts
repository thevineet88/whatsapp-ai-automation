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
import { generateKnowledgeAnswer } from "@/lib/llm/generateAnswer";
import type { UnderstandingClassifier } from "@/lib/llm/understanding";
import type { Embedder } from "@/lib/rag/embedder";
import { listBatches } from "@/lib/tools/packages";
import { getPaymentSchedule, getPrice } from "@/lib/tools/pricing";
import { eq } from "drizzle-orm";
import { type Catalogue, type CatalogueEntry, loadCatalogue } from "./catalogue";
import { classifyEscalationKeywords, classifyIntent } from "./intent";
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
};

export type ConversationStatus =
  | "open"
  | "escalated"
  | "awaiting_human"
  | "human_active"
  | "closed";

export type ConversationRouteState = {
  packageId: string | null;
  pendingClarificationCount: number;
  status: ConversationStatus;
  // Oldest first. Gives the understanding pass enough context to resolve
  // follow ups like "and how much is it?" against the trip already in play.
  history: { role: "traveller" | "bot"; content: string }[];
};

export type RouteResult = {
  replyText: string | null;
  nextPackageId: string | null;
  nextPendingClarificationCount: number;
  escalateReason: string | null;
  escalateSeverity: EscalationSeverity | null;
  sourceChunkIds: string[] | null;
};

function noReply(state: ConversationRouteState): RouteResult {
  return {
    replyText: null,
    nextPackageId: state.packageId,
    nextPendingClarificationCount: state.pendingClarificationCount,
    escalateReason: null,
    escalateSeverity: null,
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
  if (state.status === "human_active" || state.status === "closed") {
    return noReply(state);
  }

  const catalogue = await loadCatalogue(db, tenantId);

  // Deterministic pre-gate first: the riskiest topics escalate without
  // waiting on a model call, and cannot be talked out of it downstream.
  const keywordReason = classifyEscalationKeywords(text);

  let understanding: MessageUnderstanding | null = null;
  if (!keywordReason) {
    try {
      understanding = await rag.understandingClassifier({
        message: text,
        history: state.history,
        anchoredPackageId: state.packageId,
        catalogue,
      });
    } catch (error) {
      console.error("routeMessage: understanding classifier failed, using keyword fallback", {
        tenantId,
        error,
      });
    }
  }

  const escalation = resolveEscalation(keywordReason, understanding);
  if (escalation) {
    return {
      replyText: escalationReply(escalation.reason, holdingReplyMessage),
      nextPackageId:
        validatePackageId(understanding?.packageId ?? null, catalogue) ?? state.packageId,
      nextPendingClarificationCount: 0,
      escalateReason: escalation.reason,
      escalateSeverity: escalation.severity,
      sourceChunkIds: null,
    };
  }

  // The classifier is down. Fall back to the deterministic keyword router so
  // the traveller still gets a real answer rather than a holding reply.
  if (!understanding) {
    return routeWithKeywordFallback(db, tenantId, state, holdingReplyMessage, text, rag, catalogue);
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
    const OVERRIDEABLE = new Set<UnderstoodIntent>([
      "general_knowledge",
      "best_season",
      "other",
    ]);
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
  const NON_TOOL_INTENTS = new Set<UnderstoodIntent>([
    "general_knowledge",
    "best_season",
    "other",
  ]);
  if (
    anchored &&
    NON_TOOL_INTENTS.has(understanding.intent) &&
    !understanding.namedUnrecognizedPlace
  ) {
    if (transportKeywordsHit(text)) {
      understanding = { ...understanding, intent: "departure_point" };
    }
  }

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
  });

  return outcome;
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
  const questionWords = /\b(what|how|why|when|where|which|do|does|did|is|are|can|could|should|will|would)\b/i;
  return questionWords.test(text);
}

// Only commits when exactly one package matches: an ambiguous term must
// still reach a clarifying question rather than silently pick a trip.
function singleDeterministicMatch(text: string, catalogue: Catalogue): CatalogueEntry | null {
  const { matched } = matchPackages(text, catalogue);
  return matched.length === 1 ? matched[0] : null;
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
};

async function buildReply(input: BuildReplyInput): Promise<RouteResult> {
  const { db, tenantId, rag, catalogue, intent, anchored, candidateIds, state, text } = input;

  const keep = (replyText: string | null, extra?: Partial<RouteResult>): RouteResult => ({
    replyText,
    nextPackageId: anchored?.id ?? state.packageId,
    nextPendingClarificationCount: 0,
    escalateReason: null,
    escalateSeverity: null,
    sourceChunkIds: null,
    ...extra,
  });

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
      escalateReason: "clarification_limit_reached",
      escalateSeverity: severityFor("clarification_limit_reached"),
      sourceChunkIds: null,
    };
  }

  return {
    replyText:
      named.length > 1 ? clarifyBetweenCandidatesReply(named) : clarifyPackageReply(catalogue),
    nextPackageId: state.packageId,
    nextPendingClarificationCount: nextCount,
    escalateReason: null,
    escalateSeverity: null,
    sourceChunkIds: null,
  };
}

async function runAnchoredIntent(input: BuildReplyInput): Promise<RouteResult> {
  const { db, tenantId, intent, anchored } = input;
  if (!anchored) {
    throw new Error("runAnchoredIntent called without an anchored package");
  }

  const prefixed = (text: string) =>
    withAnchorContext(text, input.anchorFromThisMessage, anchored.name);

  try {
    const outcome = await runToolIntent(db, tenantId, anchored, asToolIntent(intent));

    // A single message often carries two questions ("when is it, and how
    // much?"). Answering one and ignoring the other reads as not listening.
    const secondary = input.secondaryIntent;
    if (secondary && secondary !== intent && isToolIntent(secondary) && !outcome.escalateReason) {
      try {
        const extra = await runToolIntent(db, tenantId, anchored, secondary);
        if (!extra.escalateReason) {
          return {
            replyText: prefixed(`${outcome.text}\n\n${extra.text}`),
            nextPackageId: anchored.id,
            nextPendingClarificationCount: 0,
            escalateReason: null,
            escalateSeverity: null,
            sourceChunkIds: null,
          };
        }
      } catch {
        // The primary answer already stands; a failing follow-on question is
        // not a reason to withhold it.
      }
    }

    return {
      // A soft-escalating outcome (e.g. "no upcoming batches") still names
      // the specific package in its own text, so the prefix still applies;
      // only the generic tool_error holding message below is exempt.
      replyText: prefixed(outcome.text),
      nextPackageId: anchored.id,
      nextPendingClarificationCount: 0,
      escalateReason: outcome.escalateReason,
      escalateSeverity: outcome.escalateReason ? severityFor(outcome.escalateReason) : null,
      sourceChunkIds: null,
    };
  } catch (error) {
    console.error("routeMessage: tool layer threw", {
      tenantId,
      packageId: anchored.id,
      intent,
      error,
    });
    return {
      replyText: escalationReply("tool_error", input.holdingReplyMessage),
      nextPackageId: anchored.id,
      nextPendingClarificationCount: 0,
      escalateReason: "tool_error",
      escalateSeverity: severityFor("tool_error"),
      sourceChunkIds: null,
    };
  }
}

async function answerFromKnowledge(input: BuildReplyInput): Promise<RouteResult> {
  const { db, tenantId, rag, anchored, state, text, holdingReplyMessage } = input;

  try {
    const outcome = await generateKnowledgeAnswer(db, tenantId, rag.embedder, rag.answerGenerator, {
      question: text,
      packageId: anchored?.id ?? null,
      packageName: anchored?.name ?? null,
    });

    if (outcome.kind === "answered") {
      return {
        replyText: anchored
          ? withAnchorContext(outcome.text, input.anchorFromThisMessage, anchored.name)
          : outcome.text,
        nextPackageId: anchored?.id ?? state.packageId,
        nextPendingClarificationCount: 0,
        escalateReason: null,
        escalateSeverity: null,
        sourceChunkIds: outcome.sourceIds,
      };
    }

    return {
      replyText: escalationReply(outcome.reason, holdingReplyMessage),
      nextPackageId: anchored?.id ?? state.packageId,
      nextPendingClarificationCount: 0,
      escalateReason: outcome.reason,
      escalateSeverity: severityFor(outcome.reason),
      sourceChunkIds: null,
    };
  } catch (error) {
    console.error("routeMessage: knowledge answer pipeline threw", {
      tenantId,
      packageId: anchored?.id ?? null,
      error,
    });
    return {
      replyText: escalationReply("tool_error", holdingReplyMessage),
      nextPackageId: anchored?.id ?? state.packageId,
      nextPendingClarificationCount: 0,
      escalateReason: "tool_error",
      escalateSeverity: severityFor("tool_error"),
      sourceChunkIds: null,
    };
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
  });

  return outcome;
}
