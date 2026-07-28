import type { packages } from "@/lib/db/schema";

type PackageRef = Pick<typeof packages.$inferSelect, "name" | "slug">;

const STOPWORDS = new Set(["the", "and", "tour", "trip", "yatra", "special"]);

function keywordsFor(pkg: PackageRef): string[] {
  const words = [pkg.name, ...pkg.slug.split("-")].map((w) => w.toLowerCase());
  return words.filter((word) => word.length >= 4 && !STOPWORDS.has(word));
}

// Matches a package mentioned by name in free text, e.g. "kedarnath" or
// "gokarna-murudeshwar" against the package's name and slug segments. Small,
// deterministic, no LLM: good enough for the current handful of packages.
export function resolvePackageFromText<T extends PackageRef>(
  text: string,
  candidates: T[],
): T | null {
  const normalized = text.toLowerCase();

  for (const pkg of candidates) {
    if (keywordsFor(pkg).some((keyword) => normalized.includes(keyword))) {
      return pkg;
    }
  }

  return null;
}
