import type { Db } from "@/lib/db/client";
import { conversations, escalations, messages, whatsappAccounts } from "@/lib/db/schema";
import { scopedDb } from "@/lib/db/scoped";
import { getActiveTenantConfig, getHoldingReplyMessage } from "@/lib/db/tenantConfig";
import type { EscalationSeverity } from "@/lib/guardrails/escalationPolicy";
import { type AnswerGenerator, createDeepSeekAnswerGenerator } from "@/lib/llm/answerModel";
import {
  type CollectorExtractor,
  createDeepSeekCollectorExtractor,
} from "@/lib/llm/collectorExtractor";
import {
  type UnderstandingClassifier,
  createDeepSeekUnderstandingClassifier,
} from "@/lib/llm/understanding";
import { findInboundMessageId, persistMessageTrace } from "@/lib/observability/persistTrace";
import { reportError } from "@/lib/observability/sentry";
import type { WhatsAppInboundJob } from "@/lib/queue/whatsappInboundQueue";
import { type Embedder, createJinaEmbedder } from "@/lib/rag/embedder";
import { type ConversationStatus, routeMessage } from "@/lib/router/route";
import { type WhatsAppClient, createWhatsAppClient } from "@/lib/whatsapp/client";
import { createRedis } from "@/lib/redis/client";
import { and, asc, eq } from "drizzle-orm";

// How many prior turns the understanding pass sees. Enough to resolve a
// follow up ("and the price?") without paying for the whole thread.
const HISTORY_TURNS = 8;

// Timing labels for latency debugging. Every stage logs its elapsed ms so
// you can spot whether the delay is lock contention, a slow LLM call, or
// a hang in retrieval.
type StageTimer = { label: string; start: number };
function startStage(label: string): StageTimer {
  return { label, start: Date.now() };
}
function logStage(t: StageTimer): void {
  console.log("wa handler: stage done", { stage: t.label, elapsedMs: Date.now() - t.start });
}

export type AnswerMessageDeps = {
  db: Db;
  createClient?: (accessToken: string, phoneNumberId: string) => WhatsAppClient;
  embedder?: Embedder;
  answerGenerator?: AnswerGenerator;
  understandingClassifier?: UnderstandingClassifier;
  collectorExtractor?: CollectorExtractor;
};

export async function handleInboundMessage(
  deps: AnswerMessageDeps,
  job: WhatsAppInboundJob,
): Promise<void> {
  const {
    db,
    createClient = defaultCreateClient,
    embedder = defaultEmbedder(),
    answerGenerator = defaultAnswerGenerator(),
    understandingClassifier = defaultUnderstandingClassifier(),
    collectorExtractor = defaultCollectorExtractor(),
  } = deps;
  const { tenantId, whatsappAccountId, message } = job;

  const [account] = await db
    .select()
    .from(whatsappAccounts)
    .where(eq(whatsappAccounts.id, whatsappAccountId))
    .limit(1);

  if (!account || account.tenantId !== tenantId) {
    throw new Error(`whatsapp account not found for tenant: ${whatsappAccountId}`);
  }

  const scoped = scopedDb(db, tenantId);
  const conversationTimer = startStage("conversation_lookup");
  const [existingConversation] = await scoped.conversations.findMany(
    eq(conversations.travellerPhone, message.from),
  );
  logStage(conversationTimer);

  const conversation =
    existingConversation ??
    (
      await db
        .insert(conversations)
        .values({ tenantId, whatsappAccountId, travellerPhone: message.from })
        .returning()
    )[0];

  // Per-traveller serialization: two messages from the same phone arriving
  // near-simultaneously (BullMQ concurrency:5) would otherwise race on
  // conversation state, package anchor, and clarification count. A Redis
  // lock keyed on the traveller phone serializes processing while keeping
  // the full concurrency benefit for messages from different numbers.
  // If the lock is held, the job throws and BullMQ retries it.
  const redisUrl = process.env.REDIS_URL;
  let redis: ReturnType<typeof createRedis> | null = null;
  let lockAcquired = false;
  let lockKey: string | null = null;
  if (redisUrl) {
    const lockTimer = startStage("redis_lock");
    redis = createRedis(redisUrl);
    lockKey = `wa:lock:${tenantId}:${message.from}`;
    const LOCK_TTL_SECONDS = 10;
    const LOCK_WAIT_MS = 5_000;
    const LOCK_POLL_INTERVAL_MS = 200;
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      const setResult = await redis.set(
        lockKey,
        "1",
        "EX",
        LOCK_TTL_SECONDS,
        "NX",
      );
      if (setResult === "OK") {
        lockAcquired = true;
        break;
      }
      await new Promise((r) => setTimeout(r, LOCK_POLL_INTERVAL_MS));
    }
    logStage(lockTimer);
    if (!lockAcquired) {
      console.error("wa handler: per-traveller lock timeout, re-queuing", {
        tenantId,
        travellerPhone: maskPhone(message.from),
      });
      redis.disconnect();
      redis = null;
      throw new Error("per-traveller lock timeout");
    }
  }

  try {
    // Meta delivers voice notes, images, videos, stickers, etc. as non-text
    // message types. The router has no way to answer these, so we send a
    // typed reply asking the traveller to type their question and return
    // early. Feeding a placeholder like "[unsupported message type: audio]"
    // into the LLM pipeline wastes a model call and returns a generic holding
    // reply to a perfectly reasonable traveller.
    const UNSUPPORTED_TYPES = new Set(["audio", "image", "video", "document", "sticker", "location", "contacts"]);
    const inboundContent = message.text?.body ?? `[unsupported message type: ${message.type}]`;
    const isUnsupportedText = !message.text?.body && UNSUPPORTED_TYPES.has(message.type);

    const activeConfig = await getActiveTenantConfig(db, tenantId);

    // Idempotent per invariant 7. A job that is retried after a failed send
    // must not persist the traveller's message a second time; the unique index
    // on meta_message_id makes that impossible rather than merely unlikely.
    // The boolean tells us whether the row was actually new (inserted) vs
    // already there from a prior job attempt — the latter means we should
    // not route again, because the bot has already replied (or decided to
    // escalate) for this message and a second pass would process the same
    // message a second time.
    const insertedInbound = await db
      .insert(messages)
      .values({
        tenantId,
        conversationId: conversation.id,
        metaMessageId: message.id,
        direction: "inbound",
        content: isUnsupportedText ? `[${message.type} message]` : inboundContent,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });

    if (insertedInbound.length === 0) {
      // This exact Meta message id was already processed by a prior job
      // attempt. The outbound reply already happened (or the job is
      // mid-retry and the reply is in flight). Either way, we must not
      // route again — doing so would advance the collector state, send a
      // second WhatsApp reply, and look like the bot double-answered.
      console.log("wa handler: skipping duplicate inbound message", {
        tenantId,
        conversationId: conversation.id,
        metaMessageId: message.id,
      });
      return;
    }

    // When an admin has taken over a thread (status === human_active), the
    // bot stays silent: we already stored the inbound message above so the
    // admin panel sees it, but we skip the router and never send a WhatsApp
    // reply. The admin's manual reply flow does not need the bot to be
    // involved; this branch ends the job and yields the lock.
    if (conversation.status === "human_active") {
      console.log("wa handler: skipping reply, human_active", { tenantId, conversationId: conversation.id });
      return;
    }

    if (isUnsupportedText) {
    const accessToken = requireEnv("WHATSAPP_ACCESS_TOKEN");
    const client = createClient(accessToken, account.phoneNumberId);
    const sendResult = await client.sendTextMessage(
      message.from,
      "I can read text messages best. Please type your question and I will help you right away!",
    );

    if (!sendResult.ok) {
      await recordEscalation({
        db,
        tenantId,
        conversationId: conversation.id,
        reason: "whatsapp_send_failed",
        severity: "hard",
        travellerPhone: message.from,
        contacts: activeConfig?.escalationContacts.map((c) => c.name) ?? [],
        detail: sendResult.error,
      });
      throw new Error(sendResult.error);
    }

    await db
      .insert(messages)
      .values({
        tenantId,
        conversationId: conversation.id,
        metaMessageId: sendResult.metaMessageId,
        direction: "outbound",
        content: "I can read text messages best. Please type your question and I will help you right away!",
        escalationReason: null,
      })
      .onConflictDoNothing();

    await db
      .update(conversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversations.id, conversation.id));

    return;
  }

  const holdingReplyMessage = getHoldingReplyMessage(activeConfig);

  const priorMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(asc(messages.createdAt));

  // Drop the message just persisted: it is the one being routed, not context.
  // Also drop the bot's own handoff replies. Showing the model three rounds
  // of "our team will get back to you shortly" taught it that a human had
  // taken the thread, so it flagged the next ordinary question as needing a
  // human too, which produced another handoff reply. The loop fed itself and
  // the traveller stopped getting answers entirely.
  const history = priorMessages
    .slice(0, -1)
    .filter((row) => !(row.direction === "outbound" && row.escalationReason !== null))
    .slice(-HISTORY_TURNS)
    .map((row) => ({
      role: row.direction === "inbound" ? ("traveller" as const) : ("bot" as const),
      content: row.content,
    }));

  const traceStart = new Date();
  let result;
  try {
    const routeTimer = startStage("routeMessage");
    result = await routeMessage(
      db,
      tenantId,
      {
        packageId: conversation.packageId,
        pendingClarificationCount: conversation.pendingClarificationCount,
        status: conversation.status,
        phase: conversation.phase,
        collectorData: (conversation.collectorData as Record<string, unknown> | null) ?? null,
        history,
      },
      holdingReplyMessage,
      inboundContent,
      { embedder, answerGenerator, understandingClassifier, collectorExtractor },
    );
    logStage(routeTimer);
  } catch (error) {
    // routeMessage should never throw (it catches and turns errors into
    // escalation replies), but a logged-in trace is the only place we'd
    // see a programmer error. Report to Sentry and let the outer handler
    // rethrow to BullMQ for retry.
    reportError(error, { tenantId, conversationId: conversation.id, phase: "routeMessage" });
    throw error;
  }

  // Persist a trace row for every inbound message. Wrapped in its own
  // try/catch so a write failure can't take down the rest of the handler -
  // the trace is diagnostic, the reply is the actual product.
  try {
    const inboundId = await findInboundMessageId(db, message.id);
    if (inboundId) {
      await persistMessageTrace({
        db,
        tenantId,
        conversationId: conversation.id,
        inboundMessageId: inboundId,
        routerResult: result,
        intent: result.trace?.intent ?? "unknown",
        configVersion: activeConfig?.version ?? 0,
        llmUsage: result.trace?.llmUsage ?? null,
        retrievedChunkIds: result.trace?.retrievedChunkIds ?? [],
        retrievalTopScore: result.trace?.retrievalTopScore ?? null,
        toolCalls: result.trace?.toolCalls ?? [],
        startTime: traceStart,
        result: result.escalateReason ? "escalated" : "answered",
      });
    }
  } catch (traceError) {
    console.error("wa handler: trace persistence failed", { tenantId, error: traceError });
  }

  // Durable state is written before the network call, not after. A failed
  // send used to throw past the escalation insert and the conversation
  // update, so the team never learned the bot had gone mute and the
  // traveller was left in permanent silence. Everything below is safe to
  // re-run: escalations dedupe by reason, and the conversation update sets
  // absolute values recomputed from the same inputs.
  if (result.escalateReason) {
    await recordEscalation({
      db,
      tenantId,
      conversationId: conversation.id,
      reason: result.escalateReason,
      severity: result.escalateSeverity ?? "hard",
      travellerPhone: message.from,
      contacts: activeConfig?.escalationContacts.map((c) => c.name) ?? [],
      detail: result.escalateDetail ?? null,
      // Collector requests (custom package, booking) are per-request:
      // each ask-all → reply pair is a separate escalation so the admin
      // view shows them as individual line items rather than collapsing
      // into one stale row.
      alwaysCreate: result.escalateReason === "custom_package_request" || result.escalateReason === "booking_request",
    });
  }

  await db
    .update(conversations)
    .set({
      packageId: result.nextPackageId,
      pendingClarificationCount: result.nextPendingClarificationCount,
      status: nextStatus(conversation.status, result.escalateSeverity),
      phase: result.nextPhase as "collecting_custom_package" | "collecting_booking" | null,
      collectorData: result.nextCollectorData as Record<string, unknown> | null,
      lastMessageAt: new Date(),
    })
    .where(eq(conversations.id, conversation.id));

  if (result.replyText === null) return;

  const accessToken = requireEnv("WHATSAPP_ACCESS_TOKEN");
  const client = createClient(accessToken, account.phoneNumberId);
  const sendTimer = startStage("whatsapp_send");
  const sendResult = await client.sendTextMessage(message.from, result.replyText);
  logStage(sendTimer);

  if (!sendResult.ok) {
    // The bot is mute: a bad token, a revoked number, an outage. That is an
    // operational emergency, not a routing outcome, so it is recorded for
    // the team before the throw that hands the job back to the queue for
    // retry. Previously this threw straight past every write and the failure
    // existed only in a log line nobody was watching.
    await recordEscalation({
      db,
      tenantId,
      conversationId: conversation.id,
      reason: "whatsapp_send_failed",
      severity: "hard",
      travellerPhone: message.from,
      contacts: activeConfig?.escalationContacts.map((c) => c.name) ?? [],
      detail: sendResult.error,
    });
    throw new Error(sendResult.error);
  }

  // Only written once the send actually succeeded, so the transcript never
  // claims the traveller was told something they never received.
  await db
    .insert(messages)
    .values({
      tenantId,
      conversationId: conversation.id,
      metaMessageId: sendResult.metaMessageId,
      direction: "outbound",
      content: result.replyText,
      sourceChunkIds: result.sourceChunkIds,
      escalationReason: result.escalateReason,
    })
    .onConflictDoNothing();
  } finally {
    if (lockAcquired && redis && lockKey) {
      try {
        await redis.del(lockKey);
      } catch {
        // Lock has a 10s TTL, so a missed release self-heals.
      }
    }
    if (redis) {
      redis.disconnect();
    }
  }
}

type RecordEscalationInput = {
  db: Db;
  tenantId: string;
  conversationId: string;
  reason: string;
  severity: EscalationSeverity;
  travellerPhone: string;
  contacts: string[];
  detail?: string | null;
  // Collector requests (custom_package_request, booking_request) should
  // each write their own row so the admin view shows every request as a
  // separate line item. Other hard escalations dedupe on
  // (conversationId, reason, status=pending) so repeated concerns don't
  // multiply into clutter.
  alwaysCreate?: boolean;
};

// Hard escalations dedupe to one pending row per reason per conversation: a
// traveller sending three messages about the same concern is one item for
// the team to action, not three, and job retries must not multiply it.
//
// Soft ones are always recorded. They are diagnostics, not queue items, and
// collapsing them hid repeated failures so thoroughly that a live outage had
// to be reproduced by hand instead of read out of the database.
async function recordEscalation(input: RecordEscalationInput): Promise<void> {
  const { db, tenantId, conversationId, reason, severity, detail, alwaysCreate } = input;

  if (severity === "hard" && !alwaysCreate) {
    const [alreadyPending] = await db
      .select()
      .from(escalations)
      .where(
        and(
          eq(escalations.conversationId, conversationId),
          eq(escalations.reason, reason),
          eq(escalations.status, "pending"),
        ),
      )
      .limit(1);

    if (alreadyPending) {
      // Update the existing pending row with the latest captured detail so
      // the human team sees the freshest traveller information rather than
      // a stale snapshot from the first escalation. A later message can
      // have filled fields the first one didn't carry.
      if (detail) {
        await db
          .update(escalations)
          .set({ detail })
          .where(
            and(
              eq(escalations.conversationId, conversationId),
              eq(escalations.reason, reason),
              eq(escalations.status, "pending"),
            ),
          );
      }
      return logEscalation(input);
    }
  }

  await db
    .insert(escalations)
    .values({ tenantId, conversationId, reason, severity, detail, status: "pending" });

  logEscalation(input);
}

// Escalation contacts are notified from here for visibility until the admin
// panel gets a proper escalation queue (step 11); WhatsApp
// business-initiated messages to them require a template outside the 24h
// session window, which isn't built yet.
function logEscalation(input: RecordEscalationInput): void {
  console.error("whatsapp router: escalation raised", {
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    reason: input.reason,
    severity: input.severity,
    travellerPhone: maskPhone(input.travellerPhone),
    escalationContacts: input.contacts,
    ...(input.detail ? { detail: input.detail } : {}),
  });
}

// Only a hard escalation moves the conversation to awaiting_human, and even
// that keeps the bot answering safe factual questions. Soft escalations (a
// timeout, weak retrieval) leave the status untouched: the team is notified,
// but a transient failure must not put the traveller behind a queue.
// Nothing here ever sets human_active; that is the admin takeover in step 11.
function nextStatus(
  current: ConversationStatus,
  severity: EscalationSeverity | null,
): ConversationStatus {
  if (current === "human_active") return current;
  if (severity === "hard") return "awaiting_human";
  return current === "escalated" ? "awaiting_human" : current;
}

function maskPhone(phone: string): string {
  return phone.length <= 4 ? "****" : `****${phone.slice(-4)}`;
}

function defaultCreateClient(accessToken: string, phoneNumberId: string): WhatsAppClient {
  return createWhatsAppClient({ accessToken, phoneNumberId });
}

// Wrapped so the API keys are only required at call time, not for every
// inbound message: most intents route to the tool layer or hardcoded
// replies and never touch retrieval or the LLM.
function defaultEmbedder(): Embedder {
  return (texts) => createJinaEmbedder(requireEnv("JINA_API_KEY"))(texts);
}

function defaultAnswerGenerator(): AnswerGenerator {
  return (input) => createDeepSeekAnswerGenerator(requireEnv("DEEPSEEK_API_KEY"))(input);
}

function defaultCollectorExtractor(): CollectorExtractor {
  return (input) => createDeepSeekCollectorExtractor(requireEnv("DEEPSEEK_API_KEY"))(input);
}

function defaultUnderstandingClassifier(): UnderstandingClassifier {
  return (input) => createDeepSeekUnderstandingClassifier(requireEnv("DEEPSEEK_API_KEY"))(input);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}
