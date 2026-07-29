import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import type { KnowledgeSourceInput } from "@/lib/core/knowledge";
import { createDb } from "@/lib/db/client";
import { packages, tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createJinaEmbedder } from "./embedder";
import { ingestKnowledgeSources } from "./ingest";
import { PACKAGE_KNOWLEDGE_CONTENT } from "./knowledgeContent";

// Ingests PACKAGE_KNOWLEDGE_CONTENT for the already-seeded Samyati tenant.
// Separate from db:seed because this makes real embedding API calls; run
// `npm run db:seed` first, then `npm run db:ingest`.
async function main() {
  const connectionString = requireEnv("DATABASE_URL");
  const apiKey = requireEnv("JINA_API_KEY");

  const db = createDb(connectionString);
  const embedder = createJinaEmbedder(apiKey);

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, "samyati-holidays"))
    .limit(1);
  if (!tenant) {
    throw new Error("Tenant 'samyati-holidays' not found. Run `npm run db:seed` first.");
  }

  const tenantPackages = await db.select().from(packages).where(eq(packages.tenantId, tenant.id));
  const packageIdBySlug = new Map(tenantPackages.map((p) => [p.slug, p.id]));

  const inputs: KnowledgeSourceInput[] = PACKAGE_KNOWLEDGE_CONTENT.map((entry) => {
    const packageId = packageIdBySlug.get(entry.packageSlug);
    if (!packageId) {
      throw new Error(`No seeded package found for slug: ${entry.packageSlug}`);
    }
    return { packageId, source: entry.source, content: entry.content };
  });

  const results = await ingestKnowledgeSources(db, tenant.id, embedder, inputs);
  const totalChunks = results.reduce((sum, r) => sum + r.chunksInserted, 0);
  console.log(`Ingested ${results.length} knowledge sources (${totalChunks} chunks).`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);

if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
