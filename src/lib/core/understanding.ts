import { z } from "zod";

// What the LLM understanding pass is allowed to say about an inbound message.
// It interprets: which question is being asked and which trip it is about.
// It never decides anything on its own, and it never produces a value: the
// router turns this into tool calls, and prices, dates and seats still come
// only from the database (invariant 1).

export const understoodIntentValues = [
  "batches",
  "price",
  "inclusions_exclusions",
  "itinerary",
  "best_season",
  "departure_point",
  "duration",
  "installments",
  "how_to_book",
  "cancellation_policy",
  // Answerable from the knowledge base rather than the tool layer: permits,
  // connectivity, altitude, what to pack, and similar factual questions.
  "general_knowledge",
  // A trip named with no specific question behind it ("Rameshwaram trip?").
  // Deserves a real summary built from data, which is what a traveller is
  // actually asking for, rather than a list of everything on offer.
  "package_overview",
  // Social turns that deserve a warm reply, not an escalation. "Hi" landing
  // in the same bucket as an unanswerable question is what used to strand
  // conversations before anyone had asked anything.
  "greeting",
  "browse_packages",
  // Traveller wants a tailor-made package rather than one of the catalogue
  // trips. Triggers the multi-turn collection flow that asks for destination,
  // dates, travellers, budget, etc., and escalates with a structured summary
  // once the human team has enough to respond.
  "custom_package_request",
  // Traveller wants to book a specific trip. Triggers a similar collection
  // flow that asks for passenger details, occupancy, and pickup preference,
  // then escalates with a structured booking request.
  "booking_request",
  "other",
] as const;
export const understoodIntentSchema = z.enum(understoodIntentValues);
export type UnderstoodIntent = z.infer<typeof understoodIntentSchema>;

// Each flag mirrors a hardcoded escalation trigger. The model raising one
// forces an escalation; the model staying silent never clears a trigger the
// keyword pre-gate already fired. Union only, never override.
export const safetyFlagsSchema = z.object({
  fitnessOrHealth: z.boolean(),
  bookingOrPayment: z.boolean(),
  complaintOrSafety: z.boolean(),
  humanRequest: z.boolean(),
});
export type SafetyFlags = z.infer<typeof safetyFlagsSchema>;

export const messageUnderstandingSchema = z.object({
  intent: understoodIntentSchema,
  // A single WhatsApp message routinely carries two questions ("when is it,
  // and how much?"). Answering only the first reads as not listening, so the
  // router serves both when a second one is present. Nullable rather than
  // optional: OpenAI structured output requires every key to be present in
  // `required`, and an optional field makes the whole schema invalid.
  secondaryIntent: understoodIntentSchema.nullable(),
  // Must be an id from the catalogue the model was given, or null. Validated
  // against that catalogue before use; an invented id is discarded.
  packageId: z.string().nullable(),
  // Populated when the message plausibly points at more than one trip, so
  // the clarifying question can name those instead of listing everything.
  packageCandidateIds: z.array(z.string()),
  // True when the message names a specific place or trip that is NOT in the
  // catalogue ("Nashik trip?", "Dubai?"). This is what stops "price of
  // Nashik trip" from silently answering with whatever trip was last
  // discussed: intent alone (price, batches, ...) can't tell a genuine
  // follow up ("and the price for that one") apart from a new, unrecognized
  // name, but this flag can, because it looks at the name itself rather
  // than the question shape around it.
  namedUnrecognizedPlace: z.boolean(),
  safetyFlags: safetyFlagsSchema,
  needsHuman: z.boolean(),
  confidence: z.number().min(0).max(1),
});
export type MessageUnderstanding = z.infer<typeof messageUnderstandingSchema>;
