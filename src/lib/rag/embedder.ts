import { createOpenAI } from "@ai-sdk/openai";
import { embedMany } from "ai";

// The embedding model must match EMBEDDING_DIMENSIONS in db/schema.ts.
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBED_TIMEOUT_MS = 30_000;

export type Embedder = (texts: string[]) => Promise<number[][]>;

export function createOpenAIEmbedder(apiKey: string): Embedder {
  const provider = createOpenAI({ apiKey });
  return async (texts) => {
    const { embeddings } = await embedMany({
      model: provider.embedding(EMBEDDING_MODEL),
      values: texts,
      abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    return embeddings;
  };
}
