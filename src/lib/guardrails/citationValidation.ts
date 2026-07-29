import type { GeneratedAnswer } from "@/lib/core/answer";
import type { RetrievedChunk } from "@/lib/rag/retrieval";

// Invariant 2: no answer without a source. Every sourceId the model cites
// must be one of the chunks actually retrieved for this question; an empty
// list, or an id the model hallucinated, fails validation and the caller
// must discard the answer and escalate.
export function validateCitations(answer: GeneratedAnswer, retrieved: RetrievedChunk[]): boolean {
  if (answer.sourceIds.length === 0) return false;
  const retrievedIds = new Set(retrieved.map((chunk) => chunk.id));
  return answer.sourceIds.every((id) => retrievedIds.has(id));
}
