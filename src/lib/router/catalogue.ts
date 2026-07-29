import type { Db } from "@/lib/db/client";
import { packageAliases, packages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

type PackageRow = typeof packages.$inferSelect;

export type CatalogueEntry = {
  id: string;
  name: string;
  slug: string;
  categories: string[];
  durationDays: number;
  durationNights: number;
  departurePoint: string;
  // Places the trip actually visits, lifted from the itinerary day titles.
  // This is what lets "trip to Omkareshwar" or "anything going to Varanasi"
  // resolve without anyone hand-maintaining a keyword list.
  places: string[];
  // Curated colloquial names from the package_aliases table.
  aliases: string[];
};

export type Catalogue = CatalogueEntry[];

// Words that appear in itinerary titles but describe the logistics of the
// day rather than a place, so they must never become matchable place names.
const ITINERARY_NOISE = new Set([
  "board",
  "train",
  "arrive",
  "arrival",
  "depart",
  "departure",
  "return",
  "overnight",
  "journey",
  "sightseeing",
  "darshan",
  "temple",
  "visit",
  "check",
  "day",
  "morning",
  "evening",
  "night",
  "free",
  "leisure",
  "transfer",
  "drive",
  "flight",
  "hotel",
  "breakfast",
  "lunch",
  "dinner",
  "meals",
  "express",
  "pickup",
  "drop",
  "back",
  "home",
  "tour",
  "trip",
  "yatra",
  "special",
  "and",
  "the",
  "via",
  "from",
  "with",
]);

function extractPlaces(pkg: PackageRow): string[] {
  const found = new Set<string>();
  for (const day of pkg.itinerary) {
    // Title only, not the description: titles are terse and place-led
    // ("Arrive Varanasi - Ganga Aarti"), while descriptions are prose and
    // would drag in far too much noise to match against.
    for (const word of day.title.toLowerCase().match(/[a-z]+/g) ?? []) {
      if (word.length >= 4 && !ITINERARY_NOISE.has(word)) {
        found.add(word);
      }
    }
  }
  return [...found];
}

export async function loadCatalogue(db: Db, tenantId: string): Promise<Catalogue> {
  const rows = await db.select().from(packages).where(eq(packages.tenantId, tenantId));
  const aliasRows = await db
    .select()
    .from(packageAliases)
    .where(eq(packageAliases.tenantId, tenantId));

  const aliasesByPackage = new Map<string, string[]>();
  for (const row of aliasRows) {
    const existing = aliasesByPackage.get(row.packageId);
    if (existing) {
      existing.push(row.alias);
    } else {
      aliasesByPackage.set(row.packageId, [row.alias]);
    }
  }

  return rows.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    slug: pkg.slug,
    categories: pkg.category,
    durationDays: pkg.durationDays,
    durationNights: pkg.durationNights,
    departurePoint: pkg.departurePoint,
    places: extractPlaces(pkg),
    aliases: aliasesByPackage.get(pkg.id) ?? [],
  }));
}

// Compact rendering for the understanding prompt. Deliberately small: the
// model needs enough to tell the trips apart and recognise a place or a
// colloquial name, not the full itinerary text.
export function renderCatalogueForPrompt(catalogue: Catalogue): string {
  return catalogue
    .map((entry) => {
      const parts = [
        `id: ${entry.id}`,
        `name: ${entry.name}`,
        `categories: ${entry.categories.join(", ")}`,
        `duration: ${entry.durationDays}D/${entry.durationNights}N`,
        `departs from: ${entry.departurePoint}`,
        `visits: ${entry.places.join(", ")}`,
      ];
      if (entry.aliases.length > 0) {
        parts.push(`also called: ${entry.aliases.join(", ")}`);
      }
      return parts.join("\n");
    })
    .join("\n\n---\n\n");
}
