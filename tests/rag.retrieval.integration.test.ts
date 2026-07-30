import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KnowledgeSourceInput } from "../src/lib/core/knowledge";
import type { Db } from "../src/lib/db/client";
import { createDb } from "../src/lib/db/client";
import { packages, tenants } from "../src/lib/db/schema";
import { EMBEDDING_DIMENSIONS } from "../src/lib/db/schema";
import { seedSamyati } from "../src/lib/db/seed";
import type { Embedder } from "../src/lib/rag/embedder";
import { ingestKnowledgeSource, ingestKnowledgeSources } from "../src/lib/rag/ingest";
import { hybridRetrieve } from "../src/lib/rag/retrieval";

// Deterministic stand-in for a real embedding model: hashes each word into
// one of the vector's dimensions and L2-normalizes. No network call, so it
// runs in CI, and it gives shared-vocabulary text a meaningfully higher
// cosine similarity, which is enough to exercise the vector-search half of
// hybrid retrieval without a live OpenAI key.
const fakeEmbedder: Embedder = async (texts) =>
  texts.map((text) => {
    const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
    for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = (hash * 31 + word.charCodeAt(i)) >>> 0;
      }
      vector[hash % EMBEDDING_DIMENSIONS] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  });

let container: StartedPostgreSqlContainer;
let db: Db;
let tenant: Awaited<ReturnType<typeof seedSamyati>>;
let sikkimPackageId: string;
let gokarnaPackageId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  db = createDb(container.getConnectionUri());
  await migrate(db, { migrationsFolder: "./drizzle" });
  tenant = await seedSamyati(db);

  const tenantPackages = await db.select().from(packages);
  sikkimPackageId = tenantPackages.find((p) => p.slug === "sikkim-darjeeling")?.id ?? "";
  gokarnaPackageId = tenantPackages.find((p) => p.slug === "gokarna-murudeshwar")?.id ?? "";

  const sources: KnowledgeSourceInput[] = [
    {
      packageId: sikkimPackageId,
      source: "best_season",
      content:
        "The best season for Sikkim and Nathula Pass is March to June and October to December. Monsoon brings landslide risk in the hills.",
    },
    {
      packageId: gokarnaPackageId,
      source: "best_season",
      content:
        "Gokarna beach season runs October to March with dry weather. Monsoon brings heavy rain and rough seas on the Karnataka coast.",
    },
    {
      packageId: null,
      source: "company_policy",
      content:
        "Samyati Holidays operates fixed-departure group tours from Mumbai and Pune with a tour manager on every batch.",
    },
  ];

  await ingestKnowledgeSources(db, tenant.id, fakeEmbedder, sources);
}, 120_000);

afterAll(async () => {
  await db.$pool.end();
  await container.stop();
}, 30_000);

describe("hybridRetrieve", () => {
  it("ranks the chunk sharing the most vocabulary with the query highest", async () => {
    const results = await hybridRetrieve(
      db,
      tenant.id,
      fakeEmbedder,
      "Sikkim Nathula monsoon season",
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].source).toBe("best_season");
    expect(results[0].packageId).toBe(sikkimPackageId);
  });

  it("filters to a package plus general chunks when packageId is set", async () => {
    const results = await hybridRetrieve(db, tenant.id, fakeEmbedder, "monsoon season weather", {
      packageId: gokarnaPackageId,
    });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect([gokarnaPackageId, null]).toContain(result.packageId);
    }
    expect(results.some((r) => r.packageId === sikkimPackageId)).toBe(false);
  });

  it("never returns another tenant's chunks", async () => {
    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: "Other Tenant", slug: "other-tenant" })
      .returning();
    await ingestKnowledgeSource(db, otherTenant.id, fakeEmbedder, {
      packageId: null,
      source: "other_tenant_note",
      content: "This chunk belongs to a different tenant and must never leak across tenants.",
    });

    const results = await hybridRetrieve(
      db,
      tenant.id,
      fakeEmbedder,
      "different tenant leak chunk",
    );
    expect(results.every((r) => r.source !== "other_tenant_note")).toBe(true);
  });
});
