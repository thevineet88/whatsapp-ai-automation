// Pure text chunking, no I/O. Splits on paragraph boundaries and packs them
// into chunks up to maxChars, carrying a bit of trailing context forward as
// overlap so a fact split across paragraphs stays retrievable from either
// chunk.

export type Chunk = { content: string; index: number };

const DEFAULT_MAX_CHARS = 800;
const DEFAULT_OVERLAP_CHARS = 120;

export function chunkText(
  text: string,
  opts: { maxChars?: number; overlapChars?: number } = {},
): Chunk[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = opts.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars || current === "") {
      current = candidate;
      continue;
    }
    chunks.push(current);
    const overlap = current.slice(Math.max(0, current.length - overlapChars));
    current = `${overlap}\n\n${paragraph}`;
  }
  if (current) chunks.push(current);

  return chunks.map((content, index) => ({ content, index }));
}
