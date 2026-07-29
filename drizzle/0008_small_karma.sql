-- Switch knowledge_chunks embeddings from OpenAI's text-embedding-3-small
-- (1536 dims) to Jina's jina-embeddings-v2-base-en (768 dims). The change
-- is not data-preserving: pgvector cannot cast a 1536-dim row into a 768-dim
-- column, so we truncate first and rely on the seed script to re-embed.
-- Safe at this point because there is no production data -- only seed rows.
TRUNCATE TABLE "knowledge_chunks";
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(768);
