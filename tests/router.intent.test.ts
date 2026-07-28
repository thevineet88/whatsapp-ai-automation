import { describe, expect, it } from "vitest";
import { classifyIntent } from "../src/lib/router/intent";
import { resolvePackageFromText } from "../src/lib/router/packageMatch";

describe("classifyIntent", () => {
  it("classifies fitness and health questions as an escalation, ahead of any informational match", () => {
    expect(classifyIntent("Is this trip okay for someone with a knee injury?")).toEqual({
      kind: "escalate",
      reason: "fitness_or_health",
    });
    expect(classifyIntent("My mother is a senior citizen, is it safe for her?")).toEqual({
      kind: "escalate",
      reason: "fitness_or_health",
    });
  });

  it("classifies real booking or payment intent as an escalation, not the how-to-book FAQ", () => {
    expect(classifyIntent("I want to book this trip now")).toEqual({
      kind: "escalate",
      reason: "booking_or_payment",
    });
    expect(classifyIntent("Please send payment link")).toEqual({
      kind: "escalate",
      reason: "booking_or_payment",
    });
  });

  it("classifies the how-to-book FAQ as a known, non-escalating intent", () => {
    expect(classifyIntent("How to book this package?")).toEqual({
      kind: "known",
      type: "how_to_book",
    });
  });

  it("classifies complaints and explicit human requests as escalations", () => {
    expect(classifyIntent("I have a complaint about the last trip")).toEqual({
      kind: "escalate",
      reason: "complaint_or_safety",
    });
    expect(classifyIntent("Can I talk to a human please")).toEqual({
      kind: "escalate",
      reason: "explicit_human_request",
    });
  });

  it("classifies the ten informational FAQ topics", () => {
    expect(classifyIntent("What are the upcoming batches?")).toEqual({
      kind: "known",
      type: "batches",
    });
    expect(classifyIntent("What is the price?")).toEqual({ kind: "known", type: "price" });
    expect(classifyIntent("What are the inclusions?")).toEqual({
      kind: "known",
      type: "inclusions_exclusions",
    });
    expect(classifyIntent("Can I see the itinerary?")).toEqual({
      kind: "known",
      type: "itinerary",
    });
    expect(classifyIntent("What is the best season to visit?")).toEqual({
      kind: "known",
      type: "best_season",
    });
    expect(classifyIntent("What is the pickup point?")).toEqual({
      kind: "known",
      type: "departure_point",
    });
    expect(classifyIntent("How many days is the trip?")).toEqual({
      kind: "known",
      type: "duration",
    });
    expect(classifyIntent("Tell me about the installments")).toEqual({
      kind: "known",
      type: "installments",
    });
    expect(classifyIntent("What is the cancellation policy?")).toEqual({
      kind: "known",
      type: "cancellation_policy",
    });
  });

  it("returns unclassified for messages that match nothing", () => {
    expect(classifyIntent("Good morning!")).toEqual({ kind: "unclassified" });
  });
});

describe("resolvePackageFromText", () => {
  const packages = [
    { id: "1", name: "Kedarnath-Badrinath Yatra", slug: "kedarnath-badrinath-yatra" },
    { id: "2", name: "Gokarna-Murudeshwar", slug: "gokarna-murudeshwar" },
    { id: "3", name: "Sikkim-Darjeeling", slug: "sikkim-darjeeling" },
  ];

  it("matches a package mentioned by a distinctive keyword", () => {
    expect(resolvePackageFromText("what's the price for Kedarnath?", packages)?.id).toBe("1");
    expect(resolvePackageFromText("tell me about gokarna trip", packages)?.id).toBe("2");
    expect(resolvePackageFromText("darjeeling tea gardens sound fun", packages)?.id).toBe("3");
  });

  it("returns null when no package is mentioned", () => {
    expect(resolvePackageFromText("what's the price?", packages)).toBeNull();
  });
});
