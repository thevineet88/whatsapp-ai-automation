import type { RetrievedChunk } from "@/lib/rag/retrieval";

// Reciprocal-rank-fusion score a chunk needs to be worth showing the LLM.
// hybridRetrieve fuses two signals with 1/(60 + rank) each, so a chunk
// ranked in roughly the top 6 of at least one signal clears this; anything
// weaker means neither vector nor full-text search found the traveller's
// question convincingly, so the retrieval gate escalates instead of calling
// the LLM at all, per the answer pipeline's step 5.
export const RETRIEVAL_SCORE_THRESHOLD = 0.015;

export function passesRetrievalGate(chunks: RetrievedChunk[]): boolean {
  const top = chunks[0];
  return top !== undefined && top.score >= RETRIEVAL_SCORE_THRESHOLD;
}
