import type { MessageUnderstanding, UnderstoodIntent } from "@/lib/core/understanding";
import type { Catalogue } from "@/lib/router/catalogue";
import type { EscalationReason } from "@/lib/router/intent";

export type EscalationSeverity = "hard" | "soft";

// Hard reasons need a person to own the conversation. Soft reasons are the
// system failing (a timeout, weak retrieval, a message nobody could parse):
// the team should still see them, but the bot must keep serving the
// traveller rather than going quiet on a problem that is not theirs.
const SOFT_REASONS = new Set([
  "retrieval_low_confidence",
  "llm_needs_human",
  "citation_invalid",
  "llm_error",
  "tool_error",
  "understanding_error",
  "unclassified_message",
  "no_upcoming_batches",
  "no_payment_schedule",
  "clarification_limit_reached",
]);

export function severityFor(reason: string): EscalationSeverity {
  return SOFT_REASONS.has(reason) ? "soft" : "hard";
}

// The model may only add caution, never remove it. The keyword pre-gate has
// already run and its verdict is final; this folds in anything the model
// additionally noticed, so a phrasing the keyword list misses ("my father is
// 74, will he manage the climb") still reaches a person.
export function resolveEscalation(
  keywordReason: EscalationReason | null,
  understanding: MessageUnderstanding | null,
): { reason: string; severity: EscalationSeverity } | null {
  if (keywordReason) {
    return { reason: keywordReason, severity: severityFor(keywordReason) };
  }
  if (!understanding) return null;

  const { safetyFlags } = understanding;
  if (safetyFlags.fitnessOrHealth) {
    return { reason: "fitness_or_health", severity: "hard" };
  }
  if (safetyFlags.bookingOrPayment) {
    return { reason: "booking_or_payment", severity: "hard" };
  }
  if (safetyFlags.complaintOrSafety) {
    return { reason: "complaint_or_safety", severity: "hard" };
  }
  if (safetyFlags.humanRequest) {
    return { reason: "explicit_human_request", severity: "hard" };
  }
  // needsHuman is a soft signal and an unstable one: the same message has
  // come back both true and false on repeat runs. It must never be able to
  // veto a question the system can answer from its own data, or a traveller
  // asking a trip's price gets a holding reply because the model had a
  // feeling. Safety flags above are absolute and are unaffected by this.
  if (understanding.needsHuman && !isSelfServiceable(understanding.intent)) {
    return { reason: "model_needs_human", severity: "hard" };
  }
  return null;
}

// Intents answered entirely from the database or from fixed copy. Nothing
// here involves judgement, so nothing here needs a person.
const SELF_SERVICEABLE_INTENTS = new Set<UnderstoodIntent>([
  "batches",
  "price",
  "inclusions_exclusions",
  "itinerary",
  "departure_point",
  "duration",
  "installments",
  "how_to_book",
  "cancellation_policy",
  "greeting",
  "browse_packages",
  "package_overview",
]);

function isSelfServiceable(intent: UnderstoodIntent): boolean {
  return SELF_SERVICEABLE_INTENTS.has(intent);
}

// A package id the model returned is only usable if it is genuinely in the
// catalogue we handed it. Same discipline as citation validation: an
// invented id is discarded rather than trusted into a price lookup.
export function validatePackageId(packageId: string | null, catalogue: Catalogue): string | null {
  if (!packageId) return null;
  return catalogue.some((entry) => entry.id === packageId) ? packageId : null;
}

export function validateCandidateIds(candidateIds: string[], catalogue: Catalogue): string[] {
  const known = new Set(catalogue.map((entry) => entry.id));
  return candidateIds.filter((id) => known.has(id));
}
