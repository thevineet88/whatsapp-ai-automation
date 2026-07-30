import { describe, expect, it } from "vitest";
import { classifyEscalationKeywords, classifyKnownIntent } from "../src/lib/router/intent";

describe("classifyEscalationKeywords — what blocks the LLM understanding pass", () => {
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

  it("returns booking_or_payment for booking and payment phrases", () => {
    expect(classifyEscalationKeywords("I want to book this trip now")).toBe("booking_or_payment");
    expect(classifyEscalationKeywords("Please book me for Kedarnath")).toBe("booking_or_payment");
    expect(classifyEscalationKeywords("Confirm my booking")).toBe("booking_or_payment");
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

describe("classifyKnownIntent — the routing decisions that determine what the bot actually does", () => {
  // This is the function route.ts calls to decide whether to fire the
  // collector. It intentionally skips the escalation pre-gate so the
  // collector can claim booking/custom-package requests before the
  // generic escalation handler sees them. The bot sends a booking form
  // for these phrases, then escalates to the human team with the
  // collected data — it does NOT answer the booking itself.

  it("returns booking_request for phrases that mean 'I want to book'", () => {
    // These are the phrases the traveller types when they are ready to
    // book. The collector fires: the bot sends the 7-field booking form.
    expect(classifyKnownIntent("I want to book this trip")).toEqual({
      type: "booking_request",
    });
    expect(classifyKnownIntent("book this trip")).toEqual({
      type: "booking_request",
    });
    expect(classifyKnownIntent("Register me for the trip")).toEqual({
      type: "booking_request",
    });
    expect(classifyKnownIntent("Register for this trip")).toEqual({
      type: "booking_request",
    });
    expect(classifyKnownIntent("Ticket book please")).toEqual({
      type: "booking_request",
    });
    expect(classifyKnownIntent("I want to register for the trip")).toEqual({
      type: "booking_request",
    });
  });

  it("returns custom_package_request for phrases that mean 'plan a custom trip'", () => {
    // These phrases trigger the 8-field custom-package collector form.
    expect(classifyKnownIntent("I want a custom package")).toEqual({
      type: "custom_package_request",
    });
    expect(classifyKnownIntent("plan a trip")).toEqual({
      type: "custom_package_request",
    });
    expect(classifyKnownIntent("Customised package for Manali")).toEqual({
      type: "custom_package_request",
    });
    expect(classifyKnownIntent("Tailor made holiday")).toEqual({
      type: "custom_package_request",
    });
    expect(classifyKnownIntent("Plan my trip for next month")).toEqual({
      type: "custom_package_request",
    });
    expect(classifyKnownIntent("any customised trip")).toEqual({
      type: "custom_package_request",
    });
    expect(classifyKnownIntent("i want a trip to goa for my family")).toEqual({
      type: "custom_package_request",
    });
  });

  it("returns null for phrases that must escalate straight to a human, never the collector", () => {
    // These phrases hit the escalation pre-gate in classifyIntent.
    // classifyKnownIntent intentionally returns null for them so the
    // collector never fires. The bot goes straight to the human team.
    expect(classifyKnownIntent("Cancel my booking")).toBeNull();
    expect(classifyKnownIntent("I want to cancel my trip")).toBeNull();
    expect(classifyKnownIntent("I want a refund please")).toBeNull();
    expect(classifyKnownIntent("refund my payment")).toBeNull();
    expect(classifyKnownIntent("Talk to a human please")).toBeNull();
    expect(classifyKnownIntent("Talk to Rohit")).toBeNull();
    expect(classifyKnownIntent("I have a complaint about the last trip")).toBeNull();
    expect(classifyKnownIntent("This felt unsafe")).toBeNull();
    expect(classifyKnownIntent("Is this trip okay for my bad knees?")).toBeNull();
    expect(classifyKnownIntent("my knees are weak")).toBeNull();
    expect(classifyKnownIntent("Is it suitable for senior citizens?")).toBeNull();
    expect(classifyKnownIntent("my child has asthma")).toBeNull();
  });

  it("returns the FAQ intent for how-to-book, not booking_request", () => {
    // "how to book" is a question about the process, not an expression
    // of booking intent. The collector must not catch it.
    expect(classifyKnownIntent("how to book this trip")).toEqual({
      type: "how_to_book",
    });
    expect(classifyKnownIntent("book kaise kare")).toEqual({
      type: "how_to_book",
    });
    expect(classifyKnownIntent("how do i book this package")).toEqual({
      type: "how_to_book",
    });
  });

  it("returns null when no known intent matches", () => {
    expect(classifyKnownIntent("Good morning!")).toBeNull();
    expect(classifyKnownIntent("thanks")).toBeNull();
  });
});
