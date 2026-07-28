import { describe, expect, it } from "vitest";
import { chunkText } from "../src/lib/rag/chunking";

describe("chunkText", () => {
  it("returns no chunks for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("keeps short text as a single chunk", () => {
    const chunks = chunkText("Paragraph one.\n\nParagraph two.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Paragraph one.\n\nParagraph two.");
    expect(chunks[0].index).toBe(0);
  });

  it("splits into multiple chunks once maxChars is exceeded", () => {
    const paragraphs = Array.from({ length: 5 }, (_, i) =>
      `Paragraph ${i} content here.`.repeat(5),
    );
    const text = paragraphs.join("\n\n");

    const chunks = chunkText(text, { maxChars: 200, overlapChars: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, i) => expect(chunk.index).toBe(i));
  });

  it("carries trailing overlap into the next chunk", () => {
    const text = `${"A".repeat(190)}\n\n${"B".repeat(190)}\n\n${"C".repeat(190)}`;
    const chunks = chunkText(text, { maxChars: 200, overlapChars: 30 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].content.startsWith("A".repeat(30))).toBe(true);
  });
});
