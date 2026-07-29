import type { CatalogueEntry } from "./catalogue";

const STOPWORDS = new Set(["the", "and", "tour", "trip", "yatra", "special"]);

// Every string that should resolve to this package: words from its name and
// slug, the places its itinerary visits, and any curated alias. The slug is
// not trusted to spell out the name (real data has "ujjain-indore" for
// "Ujjain-Indore-Omkareshwar"), so both are split independently.
function keywordsFor(entry: CatalogueEntry): string[] {
  const fromNameAndSlug = [entry.name, entry.slug]
    .flatMap((s) => s.toLowerCase().split(/[\s-]+/))
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));

  const fromAliases = entry.aliases.map((a) => a.toLowerCase());

  return [...new Set([...fromNameAndSlug, ...entry.places, ...fromAliases])];
}

export type DeterministicMatch = {
  matched: CatalogueEntry[];
};

// Deterministic first pass over the catalogue. Returns every package the text
// could plausibly mean rather than just the first hit, because a single
// place name can legitimately belong to more than one trip and silently
// picking one is how a traveller ends up quoted the wrong trip's price.
export function matchPackages(text: string, catalogue: CatalogueEntry[]): DeterministicMatch {
  const normalized = text.toLowerCase();
  const matched = catalogue.filter((entry) =>
    keywordsFor(entry).some((keyword) => normalized.includes(keyword)),
  );
  return { matched };
}

// Back-compatible single-package helper: only commits when exactly one
// package matches, so an ambiguous mention falls through to the LLM
// understanding pass or a clarifying question instead of guessing.
export function resolvePackageFromText<T extends CatalogueEntry>(
  text: string,
  catalogue: T[],
): T | null {
  const { matched } = matchPackages(text, catalogue);
  return matched.length === 1 ? (matched[0] as T) : null;
}
