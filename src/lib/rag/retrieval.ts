import type { Db } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import type { Embedder } from "./embedder";

export type RetrievedChunk = {
  id: string;
  packageId: string | null;
  content: string;
  source: string;
  score: number;
};

export type RetrieveOptions = {
  // When set, restricts results to chunks scoped to this package plus
  // general (package_id null) chunks, per the answer pipeline's rule that
  // retrieval is filtered by package once a conversation is anchored.
  packageId?: string | null;
  limit?: number;
};

const CANDIDATE_LIMIT = 20;
const RRF_K = 60;

// Hybrid retrieval: pgvector cosine similarity plus Postgres full-text
// search, merged by reciprocal rank fusion. Neither signal alone is
// reliable for short traveller messages (vector search misses exact terms
// like place names, full-text misses paraphrases), so both run and are
// fused rather than picking one.
export async function hybridRetrieve(
  db: Db,
  tenantId: string,
  embedder: Embedder,
  query: string,
  opts: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const limit = opts.limit ?? 5;
  const [queryEmbedding] = await embedder([query]);
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  const packageFilter =
    opts.packageId === undefined
      ? sql``
      : opts.packageId === null
        ? sql`and package_id is null`
        : sql`and (package_id = ${opts.packageId} or package_id is null)`;

  const vectorRows = await db.execute<{ id: string; rank: number }>(sql`
    select id, row_number() over (order by embedding <=> ${vectorLiteral}::vector) as rank
    from knowledge_chunks
    where tenant_id = ${tenantId}
    ${packageFilter}
    order by embedding <=> ${vectorLiteral}::vector
    limit ${CANDIDATE_LIMIT}
  `);

  const fullTextRows = await db.execute<{ id: string; rank: number }>(sql`
    select id, row_number() over (
      order by ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', ${query})) desc
    ) as rank
    from knowledge_chunks
    where tenant_id = ${tenantId}
    ${packageFilter}
    and to_tsvector('english', content) @@ plainto_tsquery('english', ${query})
    order by ts_rank_cd(to_tsvector('english', content), plainto_tsquery('english', ${query})) desc
    limit ${CANDIDATE_LIMIT}
  `);

  const fused = new Map<string, number>();
  for (const row of vectorRows.rows) {
    fused.set(row.id, (fused.get(row.id) ?? 0) + 1 / (RRF_K + Number(row.rank)));
  }
  for (const row of fullTextRows.rows) {
    fused.set(row.id, (fused.get(row.id) ?? 0) + 1 / (RRF_K + Number(row.rank)));
  }

  if (fused.size === 0) return [];

  const ids = [...fused.keys()];
  const chunkRows = await db.execute<{
    id: string;
    package_id: string | null;
    content: string;
    source: string;
  }>(sql`
    select id, package_id, content, source
    from knowledge_chunks
    where id in (${sql.join(ids, sql`, `)})
  `);

  return chunkRows.rows
    .map((row) => ({
      id: row.id,
      packageId: row.package_id,
      content: row.content,
      source: row.source,
      score: fused.get(row.id) ?? 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
