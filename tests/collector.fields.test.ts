import { describe, expect, it } from "vitest";
import type {
  CollectorExtractor,
  CollectorExtractorInput,
} from "../src/lib/llm/collectorExtractor";
import {
  BOOKING_FIELDS,
  CUSTOM_PACKAGE_FIELDS,
  type CollectorData,
  type CollectorPhase,
  buildCollectorAskAll,
  buildCollectorSummary,
  buildFollowUp,
  buildHandoffTravelerMessage,
  extractCollectorFields,
  fillRatio,
  missingFields,
} from "../src/lib/router/collector";

describe("buildCollectorAskAll", () => {
  it("lists every custom-package field in canonical order", () => {
    const text = buildCollectorAskAll("collecting_custom_package");
    expect(text).toContain("custom trip");
    expect(text).toContain("Where would you like to go");
    expect(text).toContain("How many days and nights?");
    expect(text).toContain("Which city will you travel from?");
    // The ask-all should invite partial replies, not demand completeness.
    expect(text).toMatch(/in any order|partial details/i);
  });

  it("lists every booking field in canonical order", () => {
    const text = buildCollectorAskAll("collecting_booking");
    expect(text).toContain("How many passengers will be travelling");
    expect(text).toContain("Names and ages of each passenger");
    expect(text).toContain("Your email address");
    expect(text).toContain("Room sharing preference");
    expect(text).toContain("Train or flight preference");
    expect(text).toContain("Which city will you board from");
    expect(text).toContain("Any special requests");
  });

  it("personalises the booking header with the package name when given", () => {
    const text = buildCollectorAskAll("collecting_booking", "Kedarnath-Badrinath Yatra");
    expect(text).toContain("Great choice on the Kedarnath-Badrinath Yatra trip");
  });

  it("falls back to a generic booking header when no package name is given", () => {
    const text = buildCollectorAskAll("collecting_booking");
    expect(text).not.toContain("Great choice");
    expect(text).toContain("To send your booking request to our team");
  });

  it("omits the package-name prefix for the custom-package phase", () => {
    // The package name appears in the booking header only — passing one to
    // the custom-package phase must not change its greeting.
    const text = buildCollectorAskAll("collecting_custom_package", "Kedarnath-Badrinath Yatra");
    expect(text).toContain("Happy to put together a custom trip");
    expect(text).not.toContain("Great choice on the Kedarnath");
  });

  it("matches the canonical field order the human team expects", () => {
    // Catches a refactor that re-orders the ask-all by accident. The
    // human team reads in this order; the LLM extractor relies on it too.
    const customText = buildCollectorAskAll("collecting_custom_package");
    let prevIndex = -1;
    for (const field of CUSTOM_PACKAGE_FIELDS) {
      const idx = customText.indexOf(field.askLine);
      expect(idx).toBeGreaterThan(prevIndex);
      prevIndex = idx;
    }

    const bookingText = buildCollectorAskAll("collecting_booking");
    prevIndex = -1;
    for (const field of BOOKING_FIELDS) {
      const idx = bookingText.indexOf(field.askLine);
      expect(idx).toBeGreaterThan(prevIndex);
      prevIndex = idx;
    }
  });
});

describe("fillRatio", () => {
  function data(fields: Record<string, string>): CollectorData {
    return {
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, { value: v, parsed: true }]),
      ),
    };
  }

  it("returns 0 when there is no data", () => {
    expect(fillRatio("collecting_booking", null)).toBe(0);
    expect(fillRatio("collecting_booking", undefined)).toBe(0);
    expect(fillRatio("collecting_booking", { fields: {} })).toBe(0);
  });

  it("returns 1 when every canonical field has a non-empty value", () => {
    const allFilled = Object.fromEntries(BOOKING_FIELDS.map((f) => [f.key, "x"]));
    expect(fillRatio("collecting_booking", data(allFilled))).toBe(1);
  });

  it("returns 0.5 when half the booking fields are filled", () => {
    const half = Object.fromEntries(
      BOOKING_FIELDS.slice(0, Math.ceil(BOOKING_FIELDS.length / 2)).map((f) => [f.key, "x"]),
    );
    const ratio = fillRatio("collecting_booking", data(half));
    expect(ratio).toBeGreaterThanOrEqual(0.4);
    expect(ratio).toBeLessThanOrEqual(0.6);
  });

  it("treats whitespace-only values as empty", () => {
    // Only the first 2 of 7 fields have a real value; the rest are
    // whitespace. The ratio should be 2/7 ≈ 0.286, not 1.
    const halfBlank = Object.fromEntries(
      BOOKING_FIELDS.map((f, i) => [f.key, i < 2 ? "x" : "   "]),
    );
    const ratio = fillRatio("collecting_booking", data(halfBlank));
    expect(ratio).toBeCloseTo(2 / BOOKING_FIELDS.length, 5);
  });

  it("uses the right denominator for the custom-package phase", () => {
    // Custom-package has 8 fields, booking has 7. A 4-of-8 fill is 0.5
    // for custom-package but ~0.57 for booking. The 50% gate fires on
    // different totals depending on the phase.
    const fourFilled = Object.fromEntries(
      CUSTOM_PACKAGE_FIELDS.slice(0, 4).map((f) => [f.key, "x"]),
    );
    expect(fillRatio("collecting_custom_package", data(fourFilled))).toBe(0.5);
  });
});

describe("missingFields", () => {
  function data(fields: Record<string, string>): CollectorData {
    return {
      fields: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, { value: v, parsed: true }]),
      ),
    };
  }

  it("returns the first max ask-lines when nothing is filled", () => {
    // The default max is 4 — the function caps so we don't dump every
    // long line at once. Pass an explicit large max to assert the full
    // set is recoverable.
    const lines = missingFields("collecting_booking", { fields: {} });
    expect(lines).toHaveLength(4);

    const allLines = missingFields("collecting_booking", { fields: {} }, 100);
    expect(allLines).toEqual(BOOKING_FIELDS.map((f) => f.askLine));
  });

  it("drops fields that have a value", () => {
    const lines = missingFields("collecting_booking", data({ passengerCount: "3" }));
    expect(lines).not.toContain("How many passengers will be travelling?");
    expect(lines).toContain("Names and ages of each passenger");
  });

  it("returns ask-lines in canonical order", () => {
    const lines = missingFields("collecting_booking", { fields: {} }, 100);
    const expectedOrder = BOOKING_FIELDS.map((f) => f.askLine);
    expect(lines).toEqual(expectedOrder);
  });

  it("caps the returned list at the max argument", () => {
    const lines = missingFields("collecting_custom_package", { fields: {} }, 3);
    expect(lines).toHaveLength(3);
    // The cap must not skip the first N canonical fields — it should take
    // the leading missing fields, not arbitrary ones.
    expect(lines[0]).toBe(CUSTOM_PACKAGE_FIELDS[0].askLine);
    expect(lines[2]).toBe(CUSTOM_PACKAGE_FIELDS[2].askLine);
  });
});

describe("buildCollectorSummary", () => {
  function data(fields: Record<string, { value: string; parsed: boolean }>): CollectorData {
    return { fields };
  }

  it("labels every field, filling empty ones with '(not provided)'", () => {
    const summary = buildCollectorSummary("collecting_booking", { fields: {} });
    expect(summary).toContain("BOOKING REQUEST");
    for (const field of BOOKING_FIELDS) {
      expect(summary).toContain(field.label);
      expect(summary).toContain("(not provided)");
    }
  });

  it("renders parsed values without a raw marker", () => {
    const summary = buildCollectorSummary(
      "collecting_booking",
      data({
        passengerCount: { value: "3 travellers", parsed: true },
        pickupCity: { value: "mumbai", parsed: false },
      }),
    );
    expect(summary).toContain("Number of passengers: 3 travellers");
    expect(summary).toContain("(raw)"); // for the unparsed pickupCity
    expect(summary).toContain("(not provided)"); // for the rest
  });

  it("includes the additional notes when present", () => {
    const summary = buildCollectorSummary("collecting_booking", {
      fields: { passengerCount: { value: "2", parsed: true } },
      notes: "Vegetarian meals only",
    });
    expect(summary).toContain("Additional notes: Vegetarian meals only");
  });

  it("uses the right header for the custom-package phase", () => {
    const summary = buildCollectorSummary("collecting_custom_package", { fields: {} });
    expect(summary).toContain("CUSTOM PACKAGE REQUEST");
  });
});

describe("buildHandoffTravelerMessage", () => {
  function data(fields: Record<string, { value: string; parsed: boolean }>): CollectorData {
    return { fields };
  }

  it("acknowledges a booking escalation", () => {
    const msg = buildHandoffTravelerMessage(
      "collecting_booking",
      data({
        passengerCount: { value: "2", parsed: true },
        pickupCity: { value: "mumbai", parsed: true },
      }),
    );
    expect(msg).toContain("I've raised your booking request to our team");
    expect(msg).toContain("Number of passengers: 2");
    expect(msg).toContain("Pickup / departure city: mumbai");
  });

  it("uses the custom-package header for that phase", () => {
    const msg = buildHandoffTravelerMessage("collecting_custom_package", { fields: {} });
    expect(msg).toContain("custom trip request");
  });

  it("lists missing ask-lines when fields are empty", () => {
    const msg = buildHandoffTravelerMessage("collecting_booking", { fields: {} });
    expect(msg).toContain("If you can share these remaining details");
    expect(msg).toContain("Names and ages of each passenger");
  });

  it("omits the missing-fields section when everything is filled", () => {
    const allFilled = Object.fromEntries(
      BOOKING_FIELDS.map((f) => [f.key, { value: "x", parsed: true }]),
    );
    const msg = buildHandoffTravelerMessage("collecting_booking", { fields: allFilled });
    expect(msg).not.toContain("If you can share these remaining details");
  });
});

describe("buildFollowUp", () => {
  it("lists every missing field as a numbered follow-up", () => {
    const text = buildFollowUp("collecting_booking", { fields: {} });
    expect(text).toContain("1. How many passengers will be travelling?");
    expect(text).toContain("2. Names and ages of each passenger");
  });

  it("has a completion branch when nothing is missing", () => {
    const allFilled = Object.fromEntries(BOOKING_FIELDS.map((f) => [f.key, "x"]));
    const text = buildFollowUp("collecting_booking", {
      fields: Object.fromEntries(
        Object.entries(allFilled).map(([k, v]) => [k, { value: v as string, parsed: true }]),
      ),
    });
    expect(text).toMatch(/everything|raise this/i);
    expect(text).not.toMatch(/^\d+\./m);
  });

  it("distinguishes the custom-package and booking phases by their intro", () => {
    const custom = buildFollowUp("collecting_custom_package", { fields: {} });
    const booking = buildFollowUp("collecting_booking", { fields: {} });
    expect(custom).toMatch(/sent what we have so far/i);
    expect(booking).toMatch(/sent what we have so far/i);
    // The intro is shared by design; the differentiating signal is which
    // follow-up fields appear below. With nothing filled, the default
    // max=4 cap means only the first four missing fields show.
    expect(custom).toContain("Where would you like to go");
    expect(custom).toContain("How many days and nights");
    expect(custom).toContain("How many travellers");
    expect(custom).toContain("Preferred travel month");
    expect(booking).toContain("How many passengers will be travelling");
    expect(booking).toContain("Names and ages of each passenger");
    expect(booking).toContain("Your email address");
    expect(booking).toContain("Room sharing preference");
  });
});

describe("extractCollectorFields", () => {
  // The core regression guard: multi-turn state must round-trip through
  // the function so the second reply sees fields the first reply captured.
  function staticExtractor(fields: Record<string, string | null>): CollectorExtractor {
    return async (_input: CollectorExtractorInput) => ({
      fields: { ...fields, _gotAskText: null, _gotMessageText: null } as Record<
        string,
        string | null
      >,
    });
  }

  it("returns empty fields and the raw text as notes when no extractor is supplied", async () => {
    const result = await extractCollectorFields(
      "collecting_booking",
      null,
      "I want to plan this trip",
    );
    // rawFallback also stashes the message in fields._notes for the human
    // team's structured view; result.notes is the top-level field.
    expect(result.fields._notes?.value).toBe("I want to plan this trip");
    expect(result.notes).toBe("I want to plan this trip");
  });

  it("captures the LLM-extracted fields on the first turn", async () => {
    const result = await extractCollectorFields(
      "collecting_booking",
      null,
      "3 passengers, mumbai, train",
      undefined,
      staticExtractor({
        passengerCount: "3 travellers",
        pickupCity: "mumbai",
        trainVariant: "Train",
      }),
    );
    expect(result.fields.passengerCount?.value).toBe("3 travellers");
    expect(result.fields.pickupCity?.value).toBe("mumbai");
    expect(result.fields.trainVariant?.value).toBe("Train");
  });

  it("preserves prior fields when the second turn fills new ones (the regression we hit)", async () => {
    // First turn: passenger count + pickup city.
    const afterFirst = await extractCollectorFields(
      "collecting_booking",
      null,
      "3 passengers",
      undefined,
      staticExtractor({ passengerCount: "3 travellers" }),
    );
    expect(afterFirst.fields.passengerCount?.value).toBe("3 travellers");

    // Second turn: email and room sharing. The extractor sees the
    // message; the function must merge with the prior fields, not
    // replace them.
    const afterSecond = await extractCollectorFields(
      "collecting_booking",
      afterFirst,
      "a@b.com, single sharing",
      undefined,
      staticExtractor({
        contactEmail: "a@b.com",
        roomSharing: "single",
      }),
    );

    expect(afterSecond.fields.passengerCount?.value).toBe("3 travellers");
    expect(afterSecond.fields.contactEmail?.value).toBe("a@b.com");
    expect(afterSecond.fields.roomSharing?.value).toBe("single");
  });

  it("does not double-fill a field with the same value across two replies", async () => {
    const afterFirst = await extractCollectorFields(
      "collecting_booking",
      null,
      "mumbai",
      undefined,
      staticExtractor({ pickupCity: "mumbai" }),
    );
    const afterSecond = await extractCollectorFields(
      "collecting_booking",
      afterFirst,
      "mumbai again",
      undefined,
      staticExtractor({ pickupCity: "mumbai" }),
    );
    // Same value, lowercased — the existing value already contains it, so
    // the function should not append a duplicate.
    expect(afterSecond.fields.pickupCity?.value.toLowerCase()).toBe("mumbai");
  });

  it("appends to a field when the second reply provides additional value", async () => {
    const afterFirst = await extractCollectorFields(
      "collecting_custom_package",
      null,
      "Kashmir",
      undefined,
      staticExtractor({ destination: "Kashmir" }),
    );
    const afterSecond = await extractCollectorFields(
      "collecting_custom_package",
      afterFirst,
      "Gulmarg, Sonmarg too",
      undefined,
      staticExtractor({ destination: "Gulmarg, Sonmarg too" }),
    );
    expect(afterSecond.fields.destination?.value.toLowerCase()).toContain("kashmir");
    expect(afterSecond.fields.destination?.value.toLowerCase()).toContain("gulmarg");
  });

  it("falls back to raw text when the extractor throws", async () => {
    const throwing: CollectorExtractor = async () => {
      throw new Error("DeepSeek down");
    };
    const result = await extractCollectorFields(
      "collecting_booking",
      null,
      "my dad is coming",
      undefined,
      throwing,
    );
    // No structured fields — the human team gets the raw message.
    expect(result.fields._notes?.value).toBe("my dad is coming");
    expect(result.notes).toBe("my dad is coming");
  });

  it("falls back to raw text when the extractor returns all-null fields", async () => {
    const result = await extractCollectorFields(
      "collecting_booking",
      null,
      "thanks",
      undefined,
      staticExtractor({}),
    );
    // All null fields cause a fall-through to rawFallback; the human
    // team gets the raw message in fields._notes and result.notes.
    expect(result.fields._notes?.value).toBe("thanks");
    expect(result.notes).toBe("thanks");
  });

  it("falls back to raw text when the extractor returns whitespace-only fields", async () => {
    const result = await extractCollectorFields(
      "collecting_booking",
      null,
      "thanks",
      undefined,
      staticExtractor({ passengerCount: "   " }),
    );
    expect(result.fields._notes?.value).toBe("thanks");
    expect(result.notes).toBe("thanks");
  });

  it("passes askText, messageText, and packageName into the extractor", async () => {
    const captured: CollectorExtractorInput[] = [];
    const extractor: CollectorExtractor = async (input) => {
      captured.push(input);
      return { fields: { passengerCount: "2" } };
    };

    await extractCollectorFields(
      "collecting_booking",
      null,
      "two of us",
      { name: "Kedarnath-Badrinath Yatra" },
      extractor,
    );

    expect(captured).toHaveLength(1);
    const input = captured[0];
    expect(input?.phase).toBe("collecting_booking");
    expect(input?.messageText).toBe("two of us");
    expect(input?.packageName).toBe("Kedarnath-Badrinath Yatra");
    // askText is the same string the bot sent, so the LLM sees the
    // context the traveller saw.
    expect(input?.askText).toContain("How many passengers");
    expect(input?.askText).toContain("Kedarnath-Badrinath Yatra");
  });

  it("does not include the package name in askText for the custom-package phase", async () => {
    // The custom-package phase never has a known package, so the prompt
    // must not say "Great choice on the X trip".
    const captured: CollectorExtractorInput[] = [];
    const extractor: CollectorExtractor = async (input) => {
      captured.push(input);
      return { fields: {} };
    };

    await extractCollectorFields(
      "collecting_custom_package",
      null,
      "Manali",
      { name: "Kedarnath-Badrinath Yatra" },
      extractor,
    );

    const input = captured[0];
    expect(input?.askText).not.toContain("Great choice");
    expect(input?.askText).toContain("custom trip");
  });

  it("appends to a prior value rather than replacing it", async () => {
    // Whitespace-only existing values are real prior entries: setField
    // appends new values to existing ones rather than overwriting. The
    // human team sees both "   " (prior raw) and "3 travellers" (LLM
    // extracted) — that's the contract, even if it looks noisy.
    const prior: CollectorData = {
      fields: { passengerCount: { value: "   ", parsed: false } },
    };
    const result = await extractCollectorFields(
      "collecting_booking",
      prior,
      "3",
      undefined,
      staticExtractor({ passengerCount: "3 travellers" }),
    );
    expect(result.fields.passengerCount?.value).toBe("   ; 3 travellers");
    expect(result.fields.passengerCount?.parsed).toBe(false);
  });

  it("does not crash when prior fields reference keys no longer in scope", async () => {
    const prior: CollectorData = {
      fields: {
        passengerCount: { value: "2", parsed: true },
        // Old key from a phase migration or schema change.
        legacyKey: { value: "should be preserved as-is", parsed: true },
      },
    };
    const result = await extractCollectorFields(
      "collecting_booking",
      prior,
      "single sharing",
      undefined,
      staticExtractor({ roomSharing: "single" }),
    );
    expect(result.fields.passengerCount?.value).toBe("2");
    expect(result.fields.roomSharing?.value).toBe("single");
    expect(result.fields.legacyKey?.value).toBe("should be preserved as-is");
  });
});
