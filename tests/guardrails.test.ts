import { describe, expect, it } from "vitest";
import type { GeneratedAnswer } from "../src/lib/core/answer";
import { validateCitations } from "../src/lib/guardrails/citationValidation";
import {
  RETRIEVAL_SCORE_THRESHOLD,
  passesRetrievalGate,
} from "../src/lib/guardrails/retrievalGate";
import type { RetrievedChunk } from "../src/lib/rag/retrieval";

function chunk(id: string, score: number): RetrievedChunk {
  return { id, packageId: null, content: "content", source: "source", score };
}

describe("passesRetrievalGate", () => {
  it("fails when there are no retrieved chunks", () => {
    expect(passesRetrievalGate([])).toBe(false);
  });

  it("fails when the top score is below the threshold", () => {
    expect(passesRetrievalGate([chunk("a", RETRIEVAL_SCORE_THRESHOLD - 0.001)])).toBe(false);
  });

  it("passes when the top score meets the threshold", () => {
    expect(passesRetrievalGate([chunk("a", RETRIEVAL_SCORE_THRESHOLD)])).toBe(true);
  });
});

describe("validateCitations", () => {
  const retrieved = [chunk("chunk-1", 0.05), chunk("chunk-2", 0.04)];

  function answer(sourceIds: string[]): GeneratedAnswer {
    return { needsHuman: false, answerText: "some answer", sourceIds };
  }

  it("fails when sourceIds is empty", () => {
    expect(validateCitations(answer([]), retrieved)).toBe(false);
  });

  it("fails when a cited id was never retrieved", () => {
    expect(validateCitations(answer(["chunk-1", "chunk-never-retrieved"]), retrieved)).toBe(false);
  });

  it("passes when every cited id was retrieved", () => {
    expect(validateCitations(answer(["chunk-1"]), retrieved)).toBe(true);
    expect(validateCitations(answer(["chunk-1", "chunk-2"]), retrieved)).toBe(true);
  });
});
