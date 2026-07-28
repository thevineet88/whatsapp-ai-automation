// Hardcoded intent classification for the top ten traveller questions plus
// the hardcoded escalation triggers. Pure text matching, no LLM: this is the
// step-7 router. Messages that don't match anything here are logged as
// "unclassified" and become the spec for the knowledge base in step 8.

export type EscalationReason =
  | "fitness_or_health"
  | "booking_or_payment"
  | "complaint_or_safety"
  | "explicit_human_request";

export type KnownIntentType =
  | "batches"
  | "price"
  | "inclusions_exclusions"
  | "itinerary"
  | "best_season"
  | "departure_point"
  | "duration"
  | "installments"
  | "how_to_book"
  | "cancellation_policy";

export type ClassifiedIntent =
  | { kind: "escalate"; reason: EscalationReason }
  | { kind: "known"; type: KnownIntentType }
  | { kind: "unclassified" };

// Order matters: escalation triggers are checked before any informational
// intent, per the hardcoded, not-model-decided escalation rules.
const ESCALATION_KEYWORDS: { reason: EscalationReason; keywords: string[] }[] = [
  {
    reason: "fitness_or_health",
    keywords: [
      "knee",
      "knees",
      "asthma",
      "pregnan",
      "cardiac",
      "heart condition",
      "blood pressure",
      "bp issue",
      "senior citizen",
      "elderly",
      "old age",
      "medical condition",
      "health condition",
      "fitness level",
      "fit for this trip",
      "altitude sickness",
      "disability",
      "wheelchair",
      "injury",
      "injured",
      "surgery",
      "diabet",
    ],
  },
  {
    reason: "booking_or_payment",
    keywords: [
      "book this trip",
      "book this tour",
      "book me",
      "i want to book",
      "want to book",
      "wanna book",
      "please book",
      "confirm my seat",
      "confirm my booking",
      "confirm booking",
      "reserve my seat",
      "reserve a seat",
      "book my seat",
      "lock my seat",
      "pay now",
      "ready to pay",
      "make the payment",
      "send payment link",
      "send the payment link",
      "upi id please",
      "refund my",
      "want a refund",
      "cancel my booking",
      "cancel my trip",
      "i want to cancel",
    ],
  },
  {
    reason: "complaint_or_safety",
    keywords: [
      "complaint",
      "complain",
      "unhappy",
      "disappointed",
      "unsafe",
      "not safe",
      "accident",
      "damage",
      "damaged",
      "lost my",
      "rude",
      "misbehav",
      "harassment",
      "scam",
      "cheated",
      "fraud",
    ],
  },
  {
    reason: "explicit_human_request",
    keywords: [
      "talk to a human",
      "talk to someone",
      "speak to a person",
      "human agent",
      "real person",
      "connect me to",
      "talk to rohit",
      "talk to shrutika",
      "talk to tejashree",
      "customer care",
      "agent please",
    ],
  },
];

const KNOWN_INTENT_KEYWORDS: { type: KnownIntentType; keywords: string[] }[] = [
  {
    type: "batches",
    keywords: [
      "upcoming batch",
      "batches",
      "next batch",
      "departure date",
      "when is the next",
      "when does it depart",
      "available dates",
      "dates available",
      "upcoming dates",
      "seats available",
      "seats left",
      "how many seats",
    ],
  },
  {
    type: "price",
    keywords: ["price", "cost", "how much", "starting from", "rate", "fare", "charges"],
  },
  {
    type: "inclusions_exclusions",
    keywords: [
      "inclusion",
      "inclusions",
      "exclusion",
      "exclusions",
      "what's included",
      "whats included",
      "what is included",
      "what's not included",
      "included in the package",
      "package include",
    ],
  },
  {
    type: "itinerary",
    keywords: [
      "itinerary",
      "day wise",
      "day-wise",
      "daily plan",
      "schedule of the trip",
      "plan for each day",
    ],
  },
  {
    type: "best_season",
    keywords: [
      "best time",
      "best season",
      "when to visit",
      "good time to visit",
      "weather in",
      "monsoon",
      "is it cold",
      "climate",
    ],
  },
  {
    type: "departure_point",
    keywords: [
      "departure point",
      "pickup point",
      "pick up point",
      "where do we start",
      "boarding point",
      "starting point",
      "departure city",
      "where does it start",
    ],
  },
  {
    type: "duration",
    keywords: [
      "how many days",
      "how many nights",
      "duration",
      "trip length",
      "how long is the trip",
      "days and nights",
    ],
  },
  {
    type: "installments",
    keywords: [
      "installment",
      "installments",
      "emi",
      "payment schedule",
      "payment plan",
      "first installment",
      "advance amount",
    ],
  },
  {
    type: "how_to_book",
    keywords: [
      "how to book",
      "how do i book",
      "how can i book",
      "booking process",
      "how does booking work",
    ],
  },
  {
    type: "cancellation_policy",
    keywords: [
      "cancellation policy",
      "cancel policy",
      "refund policy",
      "cancellation charges",
      "cancellation rules",
      "what if i cancel",
      "cancellation terms",
    ],
  },
];

export function classifyIntent(text: string): ClassifiedIntent {
  const normalized = text.toLowerCase();

  for (const { reason, keywords } of ESCALATION_KEYWORDS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      return { kind: "escalate", reason };
    }
  }

  for (const { type, keywords } of KNOWN_INTENT_KEYWORDS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      return { kind: "known", type };
    }
  }

  return { kind: "unclassified" };
}
