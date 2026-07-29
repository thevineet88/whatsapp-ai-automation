import type { Db } from "@/lib/db/client";
import { validateCitations } from "@/lib/guardrails/citationValidation";
import { passesRetrievalGate } from "@/lib/guardrails/retrievalGate";
import type { Embedder } from "@/lib/rag/embedder";
import { hybridRetrieve } from "@/lib/rag/retrieval";
import type { AnswerGenerator } from "./answerModel";

export type KnowledgeAnswerResult =
  | { kind: "answered"; text: string; sourceIds: string[] }
  | { kind: "escalate"; reason: string };

// Steps 4-7 of the answer pipeline: hybrid retrieval, the retrieval
// confidence gate, structured LLM generation, and the guardrail pass that
// validates every cited source against what was actually retrieved. Any
// failure at any stage returns an escalation reason rather than a reply -
// there is no partial or best-effort answer.
export async function generateKnowledgeAnswer(
  db: Db,
  tenantId: string,
  embedder: Embedder,
  answerGenerator: AnswerGenerator,
  input: { question: string; packageId: string | null; packageName: string | null },
): Promise<KnowledgeAnswerResult> {
  const chunks = await hybridRetrieve(db, tenantId, embedder, input.question, {
    // No anchor means search the whole knowledge base, not just the general
    // chunks. Passing null here would filter to package_id IS NULL and hide
    // every package-specific fact from anyone who hasn't named a trip yet.
    packageId: input.packageId ?? undefined,
  });

  if (!passesRetrievalGate(chunks)) {
    return { kind: "escalate", reason: "retrieval_low_confidence" };
  }

  let answer: Awaited<ReturnType<AnswerGenerator>>;
  try {
    answer = await answerGenerator({
      question: input.question,
      packageName: input.packageName,
      chunks,
    });
  } catch {
    return { kind: "escalate", reason: "llm_error" };
  }

  if (answer.needsHuman || !answer.answerText) {
    return { kind: "escalate", reason: "llm_needs_human" };
  }

  if (!validateCitations(answer, chunks)) {
    return { kind: "escalate", reason: "citation_invalid" };
  }

  return { kind: "answered", text: answer.answerText, sourceIds: answer.sourceIds };
}
