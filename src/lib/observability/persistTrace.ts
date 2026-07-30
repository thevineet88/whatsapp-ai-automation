import type { Db } from "@/lib/db/client";
import { messageTraces, messages } from "@/lib/db/schema";
import type { RouteResult } from "@/lib/router/route";
import { eq } from "drizzle-orm";

// The prompt version is currently inline. Hardcoded here so the trace row
// is reproducible: a trace written under v1 is known to have used the
// prompts in git at the pinned v1 commit.
export const PROMPT_VERSION = "v1";

// Carries the per-call model usage from `answerFromKnowledge` so it can be
// persisted into the trace row.
export type LlmUsageLike = {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

// Persists a message_traces row summarizing one inbound message's run
// through the router. Called from handleInboundMessage after routeMessage
// resolves. Independent of whether the outbound send succeeded: a bot
// mute shouldn't erase the trace.
//
// Returns the row's id so the worker can attach the matching
// langfuse_trace_id once flush completes (the current implementation
// doesn't do that; the column is wired up for when it does).
export async function persistMessageTrace(input: {
  db: Db;
  tenantId: string;
  conversationId: string;
  inboundMessageId: string;
  routerResult: RouteResult;
  intent: string;
  configVersion: number;
  llmUsage: LlmUsageLike | null;
  retrievedChunkIds: string[];
  retrievalTopScore: number | null;
  toolCalls: { name: string; input: unknown; output: unknown }[];
  startTime: Date;
  result: "answered" | "escalated" | "error";
}): Promise<void> {
  const llm = input.llmUsage;
  await input.db.insert(messageTraces).values({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    messageId: input.inboundMessageId,
    intent: input.intent,
    toolCalls: input.toolCalls,
    retrievedChunkIds: input.retrievedChunkIds,
    promptVersion: PROMPT_VERSION,
    configVersion: input.configVersion,
    llmModel: llm?.model ?? null,
    llmInputTokens: llm?.inputTokens ?? null,
    llmOutputTokens: llm?.outputTokens ?? null,
    retrievalTopScore: input.retrievalTopScore
      ? Math.round(input.retrievalTopScore * 1_000_000)
      : null,
    latencyMs: Date.now() - input.startTime.getTime(),
    result: input.result,
    escalationReason: input.routerResult.escalateReason,
    sourceChunkIds: input.routerResult.sourceChunkIds ?? null,
  });
}

// Looks up the inbound message row for a conversation by meta_message_id and
// returns its DB id. Used to wire message_traces back to messages.
export async function findInboundMessageId(db: Db, metaMessageId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.metaMessageId, metaMessageId))
    .limit(1);
  return row?.id ?? null;
}
