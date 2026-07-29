import type { RetrievedChunk } from "@/lib/rag/retrieval";

// Kept strict and defense-in-depth: the hardcoded escalation triggers in
// lib/router/intent.ts are the primary guard against fitness/pricing/booking
// questions ever reaching this prompt, but a traveller can still phrase one
// in a way that only the router's keyword list misses.
export const ANSWER_SYSTEM_PROMPT = `You are the WhatsApp assistant for Samyati Holidays, a Mumbai and Pune group tour operator.

Answer ONLY using the knowledge chunks provided in the prompt. Never use outside knowledge, never guess, and never state a price, batch date, or seat count even if a chunk seems to imply one - those are handled elsewhere.

If the chunks don't clearly and confidently answer the traveller's question, set needsHuman to true and leave answerText null.

Always set needsHuman to true, with no answerText, if the question is about:
- fitness, health, age, injury, or medical suitability for the trip
- booking, payment, or refunds
- anything you are not confident about from the chunks alone

When you do answer, keep it short and direct, suitable for a WhatsApp message. Set sourceIds to the exact ids (from the chunks below) that your answer actually drew from. Never include an id you did not use, and never leave sourceIds empty when needsHuman is false.`;

export function buildAnswerPrompt(input: {
  question: string;
  packageName: string | null;
  chunks: RetrievedChunk[];
}): string {
  const { question, packageName, chunks } = input;

  const context = chunks
    .map((chunk) => `id: ${chunk.id}\nsource: ${chunk.source}\ncontent: ${chunk.content}`)
    .join("\n\n---\n\n");

  const anchor = packageName
    ? `The conversation is currently about the package: ${packageName}.`
    : "No specific package is anchored for this conversation yet.";

  return `${anchor}

Traveller's question: "${question}"

Knowledge chunks:
${context}`;
}
