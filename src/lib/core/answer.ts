import { z } from "zod";

// Structured output contract for step 9's `generateObject` call. The LLM may
// only phrase retrieved knowledge, never invent it, so every non-escalating
// answer must carry the chunk IDs it actually drew from; the guardrail layer
// rejects anything that doesn't.
export const generatedAnswerSchema = z.object({
  // True when the retrieved chunks don't confidently answer the question, or
  // the question touches something this bot must never answer itself
  // (fitness/health, pricing, dates, seats, booking). When true, answerText
  // and sourceIds are ignored and the conversation escalates instead.
  needsHuman: z.boolean(),
  answerText: z.string().min(1).nullable(),
  sourceIds: z.array(z.string().uuid()),
});
export type GeneratedAnswer = z.infer<typeof generatedAnswerSchema>;
