import { createOpenAI } from "@ai-sdk/openai";
import { embedMany } from "ai";

// The embedding model must match EMBEDDING_DIMENSIONS in db/schema.ts.
// Jina's API follows the OpenAI embeddings schema, so we reuse
// createOpenAI with a custom base URL. Jina offers a generous free tier
// (1M tokens/month) and 768 dims from v2-base-en is well-suited for
// short FAQ-style chunks.
const EMBEDDING_MODEL = "jina-embeddings-v2-base-en";
const JINA_BASE_URL = "https://api.jina.ai/v1";
const EMBED_TIMEOUT_MS = 30_000;
// Jina's free tier is 100 RPM. embedMany defaults to
// maxParallelCalls: Infinity, which fires every batch in parallel and
// would immediately hit the rate limit, causing 429s that exhaust
// retries. Capping concurrency to 2 keeps us well under the limit while
// staying fast enough that the traveller does not wait.
const EMBED_MAX_PARALLEL = 2;
const EMBED_MAX_RETRIES = 2;

export type Embedder = (texts: string[]) => Promise<number[][]>;

export function createJinaEmbedder(apiKey: string): Embedder {
  const provider = createOpenAI({ apiKey, baseURL: JINA_BASE_URL });
  return async (texts) => {
    const { embeddings } = await embedMany({
      model: provider.embedding(EMBEDDING_MODEL),
      values: texts,
      maxParallelCalls: EMBED_MAX_PARALLEL,
      maxRetries: EMBED_MAX_RETRIES,
      abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    return embeddings;
  };
}
