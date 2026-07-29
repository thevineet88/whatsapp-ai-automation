import type { Db } from "@/lib/db/client";
import { validateCitations } from "@/lib/guardrails/citationValidation";
import { passesRetrievalGate } from "@/lib/guardrails/retrievalGate";
import type { Embedder } from "@/lib/rag/embedder";
import { hybridRetrieve } from "@/lib/rag/retrieval";
import type { AnswerGenerator, AnswerGeneratorOutput } from "./answerModel";

export type KnowledgeAnswerResult =
  | { kind: "answered"; text: string; sourceIds: string[] }
  | { kind: "escalate"; reason: string };

// Steps 4-7 of the answer pipeline: hybrid retrieval, the retrieval
// confidence gate, structured LLM generation, and the guardrail pass that
// validates every cited source against what was actually retrieved. Any
// failure at any stage returns an escalation reason rather than a reply -
// there is no partial or best-effort answer.
//
// Returns the trace-relevant retrieval metadata alongside the result so the
// router can attach it to the final RouteResult without re-querying.
export async function generateKnowledgeAnswer(
  db: Db,
  tenantId: string,
  embedder: Embedder,
  answerGenerator: AnswerGenerator,
  input: { question: string; packageId: string | null; packageName: string | null },
): Promise<{
  result: KnowledgeAnswerResult;
  llmUsage?: AnswerGeneratorOutput["usage"];
  retrievedChunkIds: string[];
  retrievalTopScore: number | null;
}> {
  const chunks = await hybridRetrieve(db, tenantId, embedder, input.question, {
    // No anchor means search the whole knowledge base, not just the general
    // chunks. Passing null here would filter to package_id IS NULL and hide
    // every package-specific fact from anyone who hasn't named a trip yet.
    packageId: input.packageId ?? undefined,
  });

  const topScore = chunks.length > 0 ? chunks[0].score : null;
  const chunkIds = chunks.map((c) => c.id);

  if (!passesRetrievalGate(chunks)) {
    return { result: { kind: "escalate", reason: "retrieval_low_confidence" }, retrievedChunkIds: chunkIds, retrievalTopScore: topScore };
  }

  let output: AnswerGeneratorOutput;
  try {
    output = await answerGenerator({
      question: input.question,
      packageName: input.packageName,
      chunks,
    });
  } catch {
    return { result: { kind: "escalate", reason: "llm_error" }, retrievedChunkIds: chunkIds, retrievalTopScore: topScore };
  }

  if (output.answer.needsHuman || !output.answer.answerText) {
    return { result: { kind: "escalate", reason: "llm_needs_human" }, llmUsage: output.usage, retrievedChunkIds: chunkIds, retrievalTopScore: topScore };
  }

  if (!validateCitations(output.answer, chunks)) {
    return { result: { kind: "escalate", reason: "citation_invalid" }, llmUsage: output.usage, retrievedChunkIds: chunkIds, retrievalTopScore: topScore };
  }

  return { result: { kind: "answered", text: output.answer.answerText, sourceIds: output.answer.sourceIds }, llmUsage: output.usage, retrievedChunkIds: chunkIds, retrievalTopScore: topScore };
}