import { describe, expect, it } from "vitest";
import {
  classifyEscalationKeywords,
  classifyIntent,
  classifyKnownIntent,
} from "../src/lib/router/intent";

describe("classifyEscalationKeywords", () => {
  it("returns null for a message with no escalation keyword", () => {
    expect(classifyEscalationKeywords("What is the price for Kedarnath?")).toBeNull();
  });

  it("returns fitness_or_health for knee, asthma, and senior citizens", () => {
    expect(classifyEscalationKeywords("Is this trip okay for my bad knees?")).toBe(
      "fitness_or_health",
    );
    expect(classifyEscalationKeywords("My child has asthma, is it safe?")).toBe(
      "fitness_or_health",
    );
    expect(classifyEscalationKeywords("Is it suitable for senior citizens?")).toBe(
      "fitness_or_health",
    );
  });

  it("returns booking_or_payment for real booking intent", () => {
    expect(classifyEscalationKeywords("I want to book this trip now")).toBe("booking_or_payment");
    expect(classifyEscalationKeywords("Please book me for Kedarnath")).toBe("booking_or_payment");
    expect(classifyEscalationKeywords("Send the payment link")).toBe("booking_or_payment");
    expect(classifyEscalationKeywords("I want a refund please")).toBe("booking_or_payment");
    expect(classifyEscalationKeywords("Cancel my booking")).toBe("booking_or_payment");
  });

  it("returns complaint_or_safety for complaints", () => {
    expect(classifyEscalationKeywords("I have a complaint about the last trip")).toBe(
      "complaint_or_safety",
    );
    expect(classifyEscalationKeywords("This felt unsafe")).toBe("complaint_or_safety");
  });

  it("returns explicit_human_request for asks to talk to a person", () => {
    expect(classifyEscalationKeywords("Talk to a human please")).toBe("explicit_human_request");
    expect(classifyEscalationKeywords("Talk to Rohit please")).toBe("explicit_human_request");
  });
});

describe("classifyIntent — real booking phrases escalate before reaching the collector", () => {
  // The hard invariant: phrases that mention "book" and trip-related action
  // are in the booking_or_payment escalation list. classifyIntent checks
  // escalation first, so the message must escalate and never reach the
  // collector. The how-to-book FAQ is exempt because its exact phrasing
  // ("how to book", "book kaise") isn't in the escalation list.
  const BOOKING_PHRASES: string[] = [
    "I want to book this trip now",
    "Please book me for Kedarnath",
    "Confirm my booking",
    "Reserve my seat",
    "Send payment link",
  ];

  for (const phrase of BOOKING_PHRASES) {
    it(`"${phrase}" escalates as booking_or_payment, not booking_request`, () => {
      expect(classifyIntent(phrase)).toEqual({
        kind: "escalate",
        reason: "booking_or_payment",
      });
    });
  }

  it("the how-to-book FAQ stays a known intent, never escalates", () => {
    expect(classifyIntent("How do I book this package?")).toEqual({
      kind: "known",
      type: "how_to_book",
    });
    expect(classifyIntent("Book kaise kare")).toEqual({
      kind: "known",
      type: "how_to_book",
    });
  });

  // The collector triggers: custom_package_request and booking_request
  // must NOT fire when a fitness or health keyword is present, even if the
  // message is also about a custom trip.
  it("fitness question inside a trip-planning message escalates, not the collector", () => {
    expect(
      classifyIntent(
        "I want to plan a trip to Manali, is it suitable for senior citizens?",
      ),
    ).toEqual({ kind: "escalate", reason: "fitness_or_health" });
    expect(classifyIntent("customise a package for me, my knees are weak")).toEqual({
      kind: "escalate",
      reason: "fitness_or_health",
    });
  });

  // complaint_or_safety wins because escalation lists are checked in
  // declaration order; complaint keywords appear after booking but before
  // explicit_human_request. The current intent list has "i want to book"
  // in the booking list, which short-circuits before complaint here.
  it("a complaint alone escalates as complaint_or_safety", () => {
    expect(
      classifyIntent("I have a complaint about the last trip"),
    ).toEqual({ kind: "escalate", reason: "complaint_or_safety" });
  });

  it("refund requests escalate as booking_or_payment", () => {
    expect(classifyIntent("I want a refund please")).toEqual({
      kind: "escalate",
      reason: "booking_or_payment",
    });
  });

  it("cancellation requests escalate as booking_or_payment", () => {
    expect(classifyIntent("Cancel my booking")).toEqual({
      kind: "escalate",
      reason: "booking_or_payment",
    });
    expect(classifyIntent("I want to cancel my trip")).toEqual({
      kind: "escalate",
      reason: "booking_or_payment",
    });
  });
});

describe("classifyIntent — known collector phrases that are NOT in the escalation list", () => {
  // Custom-package phrases that don't trip the escalation pre-gate should
  // reach custom_package_request in the known-intent table.
  const CUSTOM_PHRASES: Array<[string, { kind: "known"; type: "custom_package_request" }]> = [
    ["I want a custom package", { kind: "known", type: "custom_package_request" }],
    ["Customised package for Manali", { kind: "known", type: "custom_package_request" }],
    ["Tailor made holiday", { kind: "known", type: "custom_package_request" }],
    ["I want a trip to Goa for my family", { kind: "known", type: "custom_package_request" }],
    ["Any customised trip?", { kind: "known", type: "custom_package_request" }],
    ["Bespoke Kerala package", { kind: "known", type: "custom_package_request" }],
    ["Plan my trip for next month", { kind: "known", type: "custom_package_request" }],
    ["Plan a trip for two", { kind: "known", type: "custom_package_request" }],
  ];

  for (const [text, expected] of CUSTOM_PHRASES) {
    it(`"${text}" → custom_package_request`, () => {
      expect(classifyIntent(text)).toEqual(expected);
    });
  }

  // Booking phrases that are *not* in the escalation list reach the
  // collector through booking_request. Phrases like "register me",
  // "ticket book", "book karo" never trip the booking_or_payment list.
  const BOOKING_TRIGGERS: Array<[string, { kind: "known"; type: "booking_request" }]> = [
    ["Register me for the package", { kind: "known", type: "booking_request" }],
    ["Ticket book please", { kind: "known", type: "booking_request" }],
    ["I want to register for the trip", { kind: "known", type: "booking_request" }],
    ["Register for this trip", { kind: "known", type: "booking_request" }],
  ];

  for (const [text, expected] of BOOKING_TRIGGERS) {
    it(`"${text}" → booking_request`, () => {
      expect(classifyIntent(text)).toEqual(expected);
    });
  }
});

describe("classifyIntent — informational intents (no collector, no escalation)", () => {
  it.each([
    ["What are the upcoming batches for Kedarnath?", "batches"],
    ["What is the price?", "price"],
    ["What are the inclusions and exclusions?", "inclusions_exclusions"],
    ["Can I see the day wise itinerary?", "itinerary"],
    ["What is the best season?", "best_season"],
    ["Which train do we take?", "departure_point"],
    ["How many days is the trip?", "duration"],
    ["How do installments work?", "installments"],
    ["Cancellation policy please", "cancellation_policy"],
  ])('"%s" → %s', (text, type) => {
    expect(classifyIntent(text)).toEqual({ kind: "known", type });
  });
});

describe("classifyKnownIntent — skips the escalation pre-gate", () => {
  // classifyKnownIntent is the function the collector branch uses. It skips
  // the escalation pre-gate so the collector can claim the message before
  // the generic escalation handler sees it. This is the seam between the
  // router and the collector: when route.ts sees a collector intent here
  // and the conversation phase is null, it opens a fresh collection.
  it("returns booking_request for a phrase that classifyIntent would escalate", () => {
    // Same phrase that escalates under classifyIntent goes through here
    // as a booking_request — that's the design: the collector branch
    // claims it before the escalation branch runs.
    expect(classifyKnownIntent("I want to book this trip")).toEqual({
      type: "booking_request",
    });
  });

  it("returns booking_request for register / ticket book phrases", () => {
    expect(classifyKnownIntent("register me for the trip")).toEqual({
      type: "booking_request",
    });
    expect(classifyKnownIntent("ticket book please")).toEqual({
      type: "booking_request",
    });
  });

  it("returns custom_package_request for custom trip phrases", () => {
    expect(classifyKnownIntent("i want a custom package")).toEqual({
      type: "custom_package_request",
    });
    expect(classifyKnownIntent("plan my trip for next month")).toEqual({
      type: "custom_package_request",
    });
  });

  it("returns the FAQ intent for how-to-book rather than booking_request", () => {
    // "how to book" maps to how_to_book, not booking_request — the FAQ
    // and the action are different intents. The collector must not catch
    // a "how do I book" question.
    expect(classifyKnownIntent("how to book this trip")).toEqual({
      type: "how_to_book",
    });
  });

  it("returns null when no known intent matches", () => {
    expect(classifyKnownIntent("Good morning!")).toBeNull();
  });
});