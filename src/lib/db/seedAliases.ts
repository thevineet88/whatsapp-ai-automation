import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { packageAliases, packages, tenants } from "./schema";

// Colloquial names travellers type that a package's own fields don't
// contain. Anything already in the name, slug or itinerary (Kedarnath,
// Varanasi, Gokarna) is matched automatically and is deliberately not
// repeated here. Keyed by slug so it survives reseeding.
const ALIASES_BY_SLUG: Record<string, string[]> = {
  "kedarnath-badrinath-yatra": [
    "char dham",
    "chardham",
    "chaar dham",
    "do dham",
    "dodham",
    "uttarakhand",
    "garhwal",
    "jyotirlinga",
  ],
  "ujjain-indore": [
    "omkareshwar",
    "mahakal",
    "mahakaleshwar",
    "madhya pradesh",
    "jyotirlinga",
    "mp trip",
  ],
  "ayodhya-kashi-prayagraj": [
    "kashi vishwanath",
    "banaras",
    "benaras",
    "ram mandir",
    "sangam",
    "triveni",
    "uttar pradesh",
  ],
  "gokarna-murudeshwar": ["karnataka", "beach trip", "konkan", "west coast"],
  "sikkim-darjeeling": ["north east", "northeast", "gangtok", "nathula", "kanchenjunga"],
  "nainital-mussoorie": ["uttarakhand", "hill station", "kumaon"],
  kerala: ["god's own country", "gods own country", "backwaters", "south india"],
  rameshwaram: ["tamil nadu", "south india", "jyotirlinga", "dhanushkodi"],
};

export async function seedPackageAliases(
  db: ReturnType<typeof createDb>,
  tenantId: string,
): Promise<number> {
  const tenantPackages = await db.select().from(packages).where(eq(packages.tenantId, tenantId));

  let inserted = 0;
  for (const pkg of tenantPackages) {
    const aliases = ALIASES_BY_SLUG[pkg.slug];
    if (!aliases) continue;

    for (const alias of aliases) {
      // Idempotent: re-running adds new aliases without duplicating existing
      // ones or clobbering any the team added through the admin panel.
      const result = await db
        .insert(packageAliases)
        .values({ tenantId, packageId: pkg.id, alias })
        .onConflictDoNothing()
        .returning();
      inserted += result.length;
    }
  }
  return inserted;
}

async function main() {
  const db = createDb(requireEnv("DATABASE_URL"));
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, "samyati-holidays"))
    .limit(1);
  if (!tenant) {
    throw new Error("Tenant 'samyati-holidays' not found. Run `npm run db:seed` first.");
  }

  const inserted = await seedPackageAliases(db, tenant.id);
  console.log(`Seeded ${inserted} new package aliases.`);
  await db.$pool.end();
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
