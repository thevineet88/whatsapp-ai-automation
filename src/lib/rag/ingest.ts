import type { KnowledgeSourceInput } from "@/lib/core/knowledge";
import type { Db } from "@/lib/db/client";
import { knowledgeChunks } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { chunkText } from "./chunking";
import type { Embedder } from "./embedder";

export type IngestResult = { source: string; chunksInserted: number };

// Chunks, embeds, and stores one knowledge source, replacing any chunks
// previously ingested under the same (tenant, source, package) key. Safe to
// re-run: ingestion is idempotent per source, not additive.
export async function ingestKnowledgeSource(
  db: Db,
  tenantId: string,
  embedder: Embedder,
  input: KnowledgeSourceInput,
): Promise<IngestResult> {
  const chunks = chunkText(input.content);
  if (chunks.length === 0) {
    return { source: input.source, chunksInserted: 0 };
  }

  const embeddings = await embedder(chunks.map((c) => c.content));
  if (embeddings.length !== chunks.length) {
    throw new Error(
      `embedder returned ${embeddings.length} vectors for ${chunks.length} chunks (source: ${input.source})`,
    );
  }

  await db
    .delete(knowledgeChunks)
    .where(
      and(
        eq(knowledgeChunks.tenantId, tenantId),
        eq(knowledgeChunks.source, input.source),
        input.packageId
          ? eq(knowledgeChunks.packageId, input.packageId)
          : isNull(knowledgeChunks.packageId),
      ),
    );

  await db.insert(knowledgeChunks).values(
    chunks.map((chunk, i) => ({
      tenantId,
      packageId: input.packageId,
      source: input.source,
      content: chunk.content,
      embedding: embeddings[i],
    })),
  );

  return { source: input.source, chunksInserted: chunks.length };
}

export async function ingestKnowledgeSources(
  db: Db,
  tenantId: string,
  embedder: Embedder,
  inputs: KnowledgeSourceInput[],
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const input of inputs) {
    results.push(await ingestKnowledgeSource(db, tenantId, embedder, input));
  }
  return results;
}
