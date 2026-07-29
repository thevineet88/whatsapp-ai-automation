import { type GeneratedAnswer, generatedAnswerSchema } from "@/lib/core/answer";
import type { RetrievedChunk } from "@/lib/rag/retrieval";
import OpenAI from "openai";
import { z } from "zod";
import { ANSWER_SYSTEM_PROMPT, buildAnswerPrompt } from "./prompts";

// DeepSeek exposes only the OpenAI Chat Completions API. It supports the
// legacy json_object response format but not OpenAI's structured outputs
// (json_schema), so we ask for JSON, parse the model's response ourselves,
// and validate against the Zod schema before returning.
const ANSWER_MODEL = "deepseek-chat";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
// Invariant: structured answer generation stays at or below 0.3 so phrasing
// stays close to the retrieved chunks rather than drifting.
const ANSWER_TEMPERATURE = 0.2;
const ANSWER_TIMEOUT_MS = 20_000;
const ANSWER_MAX_RETRIES = 2;

export type AnswerGeneratorInput = {
  question: string;
  packageName: string | null;
  chunks: RetrievedChunk[];
};

export type AnswerGenerator = (input: AnswerGeneratorInput) => Promise<GeneratedAnswer>;

export function createDeepSeekAnswerGenerator(apiKey: string): AnswerGenerator {
  const client = new OpenAI({
    apiKey,
    baseURL: DEEPSEEK_BASE_URL,
  });
  return async (input) => {
    const completion = await client.chat.completions.create({
      model: ANSWER_MODEL,
      temperature: ANSWER_TEMPERATURE,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            ANSWER_SYSTEM_PROMPT +
            "\n\nRespond with a single JSON object matching this schema: " +
            JSON.stringify(z.toJSONSchema(generatedAnswerSchema)) +
            "\nDo not include any prose, explanation, or markdown fences around the JSON.",
        },
        { role: "user", content: buildAnswerPrompt(input) },
      ],
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("DeepSeek returned no answer content");
    const parsed = generatedAnswerSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      throw new Error("DeepSeek answer failed schema validation: " + parsed.error.message);
    }
    return parsed.data;
  };
}
