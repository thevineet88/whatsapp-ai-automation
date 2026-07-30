// Multi-turn collectors for custom-package and booking requests.
//
// WhatsApp messages are short and noisy, and asking the traveller for a
// structured form over multiple fields would either burn many turns or
// fail entirely (they will not paste a JSON blob). Instead:
//
// 1. On the first message that detects intent custom_package_request or
//    booking_request, the collector sends a single message listing every
//    field we need and inviting them to answer in any order or shape.
// 2. On every following message in that conversation, an LLM extractor
//    maps the traveller's free-text reply to the field keys, with a raw
//    fallback so nothing is ever lost.
// 3. When the number of filled slots crosses half the fields the human
//    team needs, the collector escalates with a structured summary, asks
//    the traveller to fill the remaining fields, and resets the phase.
// 4. Below the 50% threshold, it sends a short "we still need X, Y, Z"
//    message. Above 100% it just escalates.
//
// The extracted fields are deliberately loose: a number is a number
// whether the traveller said "3 people", "three of us", or "me, my
// husband, and our two kids". Anything we cannot parse is left as the
// raw traveller text under `raw`, so the human team still sees the
// message.

import type { CollectorExtractor } from "@/lib/llm/collectorExtractor";

export type CollectorPhase = "collecting_custom_package" | "collecting_booking";

// Fields the human team needs for a custom-package brief. Order is the
// ask-order in the first collector message; the traveller can answer in
// any order, but the order they read first tends to match what they type.
export const CUSTOM_PACKAGE_FIELDS = [
  {
    key: "destination",
    label: "Destination / region",
    askLine: "Where would you like to go? (city, region, or country)",
  },
  { key: "duration", label: "Duration", askLine: "How many days and nights?" },
  { key: "travellers", label: "Travellers", askLine: "How many travellers and their ages?" },
  { key: "dates", label: "Travel dates", askLine: "Preferred travel month or specific dates?" },
  { key: "budget", label: "Budget per person", askLine: "Approximate budget per person?" },
  {
    key: "tripType",
    label: "Trip type",
    askLine: "What kind of trip? (honeymoon / family / friends / corporate / solo / other)",
  },
  { key: "departureCity", label: "Departure city", askLine: "Which city will you travel from?" },
  {
    key: "specialRequirements",
    label: "Special requirements",
    askLine: "Anything else we should know? (room preferences, dietary, mobility, sights)",
  },
] as const;

export type CustomPackageField = (typeof CUSTOM_PACKAGE_FIELDS)[number]["key"];

// Fields the human team needs to actually book a trip.
export const BOOKING_FIELDS = [
  {
    key: "passengerCount",
    label: "Number of passengers",
    askLine: "How many passengers will be travelling?",
  },
  {
    key: "passengerDetails",
    label: "Passenger names and ages",
    askLine: "Names and ages of each passenger",
  },
  { key: "contactEmail", label: "Email", askLine: "Your email address (for booking confirmation)" },
  {
    key: "roomSharing",
    label: "Room sharing",
    askLine: "Room sharing preference (single / twin / triple / family)?",
  },
  {
    key: "trainVariant",
    label: "Train / flight variant",
    askLine: "Train or flight preference? (AC class, sleeper, flight, etc.)",
  },
  {
    key: "pickupCity",
    label: "Pickup / departure city",
    askLine: "Which city will you board from?",
  },
  {
    key: "specialRequests",
    label: "Special requests",
    askLine:
      "Any special requests? (veg/jain meals, accessibility, rooming with another traveller)",
  },
] as const;

export type BookingField = (typeof BOOKING_FIELDS)[number]["key"];

type CollectedField<T extends string> = {
  value: string;
  // True when a slot was filled with a parsed/structured value; false when
  // it is the raw traveller text. Raw still counts as filled for the 50%
  // gate, but it signals to the human team that the bot did not extract
  // anything structured.
  parsed: boolean;
};

// Generic shape stored in conversations.collectorData. The typed helpers
// below enforce which keys are valid for each phase.
export type CollectorData = {
  fields: Record<string, CollectedField<string>>;
  // Raw text that didn't map to any structured field. Stored separately so
  // it doesn't pollute a specific field like passengerCount or email.
  notes?: string;
};

function getFields(
  phase: CollectorPhase,
): readonly { key: string; label: string; askLine: string }[] {
  return phase === "collecting_custom_package" ? CUSTOM_PACKAGE_FIELDS : BOOKING_FIELDS;
}

// The first message in a collector phase. Sends every ask-line at once
// rather than asking one at a time: WhatsApp travellers answer fastest
// when they can dump everything they thought of, and one long prompt
// gets fewer "?" follow-ups than three short ones.
export function buildCollectorAskAll(phase: CollectorPhase, packageName?: string): string {
  const fields = getFields(phase);
  const intro =
    phase === "collecting_custom_package"
      ? "Happy to put together a custom trip for you. To send your request to our team, please share these details in one message:"
      : packageName
        ? `Great choice on the ${packageName} trip. To send your booking request to our team, please share these details in one message:`
        : "To send your booking request to our team, please share these details in one message:";

  const lines = fields.map((f, i) => `${i + 1}. ${f.askLine}`);
  return [
    intro,
    "",
    lines.join("\n"),
    "",
    "You can answer in any order. Even partial details help — we'll follow up for anything missing.",
  ].join("\n");
}

// Computes the fill ratio over the canonical field list. Always returns a
// number in [0, 1]. A field is "filled" if its value is a non-empty string
// after trimming. The 50% threshold is the gate to escalation.
export function fillRatio(phase: CollectorPhase, data: CollectorData | null | undefined): number {
  const fields = getFields(phase);
  if (fields.length === 0) return 0;
  const map = data?.fields ?? {};
  const filled = fields.filter((f) => {
    const entry = map[f.key];
    return entry && entry.value.trim().length > 0;
  }).length;
  return filled / fields.length;
}

// Lists the ask-lines for fields that are still empty, in canonical order,
// for the follow-up "we still need" prompt. Capped so we don't dump eight
// long lines at once.
export function missingFields(
  phase: CollectorPhase,
  data: CollectorData | null | undefined,
  max = 4,
): string[] {
  const fields = getFields(phase);
  const map = data?.fields ?? {};
  return fields
    .filter((f) => {
      const entry = map[f.key];
      return !entry || entry.value.trim().length === 0;
    })
    .slice(0, max)
    .map((f) => f.askLine);
}

// Renders the structured summary shown to the human team at handoff and
// echoed back to the traveller. Unknown / raw fields are included under
// their label so nothing the traveller said is silently dropped.
export function buildCollectorSummary(
  phase: CollectorPhase,
  data: CollectorData | null | undefined,
): string {
  const fields = getFields(phase);
  const map = data?.fields ?? {};
  const lines: string[] = [];
  lines.push(phase === "collecting_custom_package" ? "CUSTOM PACKAGE REQUEST" : "BOOKING REQUEST");
  for (const f of fields) {
    const entry = map[f.key];
    const value = entry?.value?.trim();
    if (value) {
      const suffix = entry?.parsed ? "" : " (raw)";
      lines.push(`- ${f.label}: ${value}${suffix}`);
    } else {
      lines.push(`- ${f.label}: (not provided)`);
    }
  }
  if (data?.notes) {
    lines.push(`- Additional notes: ${data.notes}`);
  }
  return lines.join("\n");
}

// ─── Extraction ────────────────────────────────────────────────────────────
//
// Each extractor reads the traveller's message text and updates the
// collector fields. It does not clear other fields: every message adds,
// nothing overwrites (except re-asking a field, which the human team can
// see in the raw text anyway). When the extractor sees an obvious
// structured value (a count, a phone, an email), it sets parsed=true;
// otherwise the entire message is treated as raw for whichever key it
// matched first.

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function numberFromText(text: string): number | null {
  const digitMatch = text.match(/\b(\d{1,3})\b/);
  if (digitMatch) return Number(digitMatch[1]);
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    if (re.test(text)) return value;
  }
  return null;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

// Conservative date sniffers — month names and quarter words. Day-of-month
// alone is too ambiguous (any number could be one), so we don't try.
const MONTH_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const QUARTER_RE = /\b(q[1-4]|first quarter|second quarter|third quarter|fourth quarter)\b/i;

// Trip-type hints — used to map a vague "it's our anniversary" message to
// a useful label rather than only catching the word "honeymoon".
const TRIP_TYPE_HINTS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(honeymoon|anniversary|just married|romantic)\b/i, label: "honeymoon" },
  { pattern: /\b(family|with kids|with children|kids trip|parents)\b/i, label: "family" },
  { pattern: /\b(corporate|office trip|company trip|team outing)\b/i, label: "corporate" },
  {
    pattern: /\b(group of|friends|college|bachelor|girls trip|boys trip)\b/i,
    label: "friends / group",
  },
  { pattern: /\b(solo|alone|by myself|single traveller|just me)\b/i, label: "solo" },
];

// Big-city list — a sniffed city that matches one of these is treated as
// a real departure city rather than a place-name appearing elsewhere.
const KNOWN_CITIES = new Set([
  "mumbai",
  "pune",
  "delhi",
  "bangalore",
  "bengaluru",
  "chennai",
  "kolkata",
  "hyderabad",
  "ahmedabad",
  "jaipur",
  "lucknow",
  "surat",
  "nagpur",
  "indore",
  "bhopal",
  "nashik",
  "goa",
  "kochi",
  "coimbatore",
  "visakhapatnam",
  "patna",
  "chandigarh",
  "gurgaon",
  "noida",
  "thane",
  "navi mumbai",
]);

function sniffDestination(text: string): string | null {
  // "want to go to X", "trip to X", "X trip", "X tour"
  const toMatch = text.match(
    /(?:go to|trip to|tour of|visit|tour to|visit to)\s+([a-z][a-z\s'-]{2,40})/i,
  );
  if (toMatch)
    return toMatch[1]
      .trim()
      .split(/\s+(?:in|on|from|with|for|and)\b/i)[0]
      .trim();
  const named = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:trip|tour|package)\b/);
  if (named) return named[1];
  // "- Kashmir" or "to Kashmir" on its own line after a numbered label.
  const standalone = text.match(/[-–•]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*$/m);
  if (standalone) return standalone[1];
  // Bare lowercase word on its own line after a numbered label (the
  // traveller answered "Where would you like to go?" with just "megayla").
  const bareLine = text.match(
    /^\s*\d+[.)]\s*(?:Where would you like to go\??\s*[-–:]?\s*)?([a-z][a-z'-]{2,30})\s*$/im,
  );
  if (bareLine) return bareLine[1];
  return null;
}

function sniffCity(text: string): string | null {
  const words = text.split(/[\s,.]+/);
  for (const w of words) {
    const lower = w.toLowerCase().replace(/[^a-z]/g, "");
    if (KNOWN_CITIES.has(lower)) {
      // Restore the original casing from the message.
      return w.replace(/[^a-zA-Z]/g, "");
    }
  }
  return null;
}

function sniffBudget(text: string): string | null {
  // The clearest signal: a number preceded by "budget", "under", "around",
  // or just sitting on its own line ("10000") next to a price hint.
  const m = text.match(
    /(?:budget|under|around|approx(?:imately)?|~|price|cost|rs\.?|inr|₹)\s*(?:of\s+)?(?:rs\.?|inr|₹)?\s*([\d,]{3,8})/i,
  );
  if (m) return `₹${m[1]} per person`;
  // Bare 4–6 digit number with a budget context ("per person 10000").
  const bare = text.match(
    /(?:per\s*person|per\s*pax|each|per\s*head|total)\s*(?:rs\.?|inr|₹)?\s*([\d,]{3,8})/i,
  );
  if (bare) return `₹${bare[1]} per person`;
  const lakh = text.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac|l)\b/i);
  if (lakh) return `₹${lakh[1]} lakh per person`;
  const k = text.match(/(\d+)k\b/i);
  if (k) return `₹${k[1]},000 per person`;
  return null;
}

function sniffDuration(text: string): string | null {
  // "5n 6d" / "6 days 5 nights" / "5 nights" / "6 days" - return whatever
  // structured form we can pull. The order of days and nights is what
  // travellers get wrong: assume whatever they said first is what they
  // actually mean and just keep both numbers.
  const compact = text.match(/(\d+)\s*([nd])\s*(\d+)\s*([nd])/i);
  if (compact) {
    const days = compact[2].toLowerCase() === "d" ? compact[1] : compact[3];
    const nights = compact[2].toLowerCase() === "n" ? compact[1] : compact[3];
    return `${days} days / ${nights} nights`;
  }
  const dn = text.match(/(\d+)\s*(?:days?|d)\s*(?:and\s*)?(\d+)?\s*(?:nights?|n)?/i);
  if (dn) {
    return dn[2] ? `${dn[1]} days / ${dn[2]} nights` : `${dn[1]} days`;
  }
  const nd = text.match(/(\d+)\s*(?:nights?|n)/i);
  if (nd) return `${nd[1]} nights`;
  return null;
}

function sniffTravellers(text: string): string | null {
  // "4 2adult 2kids", "3 adults and 2 children", "5 people", "me, my
  // husband, and our two kids" all return a count, and that's enough for
  // the human team to follow up. Breakdowns (adults / kids) are kept when
  // the traveller provides them.
  const breakdownMatch = text.match(
    /(\d+)\s*(\d+\s*adults?\s*\d+\s*kids?|\d+\s*adults?|\d+\s*kids?)/i,
  );
  if (breakdownMatch) return breakdownMatch[0].trim();
  // The traveller-count number must be followed by an actual group word,
  // not by an age. "ages 32 and 30" was being misread as 32 travellers
  // because the regex caught the first number without demanding context.
  const simple = text.match(
    /(?:^|\s|passengers?\s*[=:]\s*)(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:of\s+(?:us|them|the group)|adults?|people|persons?|travellers?|pax|kids?|children|members?)/i,
  );
  if (simple) {
    const n = numberFromText(simple[1]);
    if (n) return `${n} travellers`;
  }
  // Fallback: a bare count followed by a comma-separated list of ages,
  // where the ages are clearly not ages in context (e.g. "5
  // 30,30,30,30,30"). Take the first number if it appears at line start
  // and is followed by 2+ digits separated by commas — strong signal that
  // it is a count, not an age.
  const ageListMatch = text.match(/^\s*(\d+)\s+\d+\s*(?:,\s*\d+\s*){1,}/m);
  if (ageListMatch) {
    const n = numberFromText(ageListMatch[1]);
    if (n && n >= 1 && n <= 50) return `${n} travellers`;
  }
  return null;
}

function sniffDates(text: string): string | null {
  const segments: string[] = [];
  if (MONTH_RE.test(text)) {
    const m = text.match(MONTH_RE);
    if (m) segments.push(m[0]);
  }
  if (QUARTER_RE.test(text)) {
    const m = text.match(QUARTER_RE);
    if (m) segments.push(m[0]);
  }
  // "22 jan" or "22- jan" - just day + month, no end date.
  const dayMonth = text.match(
    /(\d{1,2})\s*[-]?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  );
  if (dayMonth && segments.length === 0) segments.push(`${dayMonth[1]} ${dayMonth[2]}`);
  const dateRange = text.match(
    /(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:to|-)\s*(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  );
  if (dateRange) segments.push(`${dateRange[1]}-${dateRange[2]} ${dateRange[3]}`);
  const fixedRange = text.match(
    /(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*(?:to|-)\s*(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  );
  if (fixedRange)
    segments.push(`${fixedRange[1]} ${fixedRange[2]} to ${fixedRange[3]} ${fixedRange[4]}`);
  if (segments.length === 0) return null;
  return segments.join(", ");
}

function sniffTripType(text: string): string | null {
  // The traveller may echo our numbered ask-all. The real answer is
  // whatever appears after the numbered question, not whatever is inside
  // the parenthetical options. Split by line, find numbered lines, and
  // check only what follows the closing paren.
  const lines = text.split(/\n/);
  for (const line of lines) {
    const answer = line.replace(/^\s*\d+\.\s*[^)]*\)\s*/, "").trim();
    if (!answer) continue;
    for (const hint of TRIP_TYPE_HINTS) {
      if (hint.pattern.test(answer)) return hint.label;
    }
  }
  // Fallback: scan the whole text (catches freeform answers that don't
  // echo the numbered format).
  for (const hint of TRIP_TYPE_HINTS) {
    if (hint.pattern.test(text)) return hint.label;
  }
  return null;
}

function sniffSpecial(text: string): string | null {
  const keys =
    /\b(veg|jain|non-?veg|wheelchair|accessib|kid-?friendly|senior|asthma|knee|allergy|allergies|halal)\b/i;
  if (keys.test(text)) {
    return text.match(/.{0,80}/)?.[0] ?? null;
  }
  return null;
}

function sniffRoomSharing(text: string): string | null {
  // Exact match first — covers "single", "twin sharing", "family room",
  // "own room", etc.
  const exact = text.match(
    /\b(single|twin|triple|quad|family room|sharing|own room|separate room)\b/i,
  );
  if (exact) return exact[1].toLowerCase();
  // Fuzzy fallback for common typos ("singel", "twn", "famil room"). Check
  // each word against known terms using a 1-edit distance window — long
  // enough to catch a single transposition or missing character, short
  // enough to avoid false positives.
  const candidates = ["single", "twin", "triple", "quad", "family", "sharing", "separate"];
  const words = text.toLowerCase().split(/\s+/);
  for (const word of words) {
    for (const candidate of candidates) {
      if (
        word.length >= 4 &&
        word.length <= candidate.length + 1 &&
        levenshtein(word, candidate) <= 1
      ) {
        return candidate === "family" ? "family room" : candidate;
      }
    }
  }
  return null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    let last = i - 1;
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j];
      if (a[i - 1] === b[j - 1]) {
        prev[j] = last;
      } else {
        prev[j] = 1 + Math.min(prev[j], prev[j - 1], last);
      }
      last = tmp;
    }
  }
  return prev[n];
}

function sniffTrainVariant(text: string): string | null {
  const m = text.match(/\b(1ac|2ac|3ac|ac|ac3|ac2|sleeper|sl|chair car|cc|flight|air|budget)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function sniffPassengerCount(text: string): string | null {
  // "Just me and my wife" / "me and my parents" → explicit number.
  const duo = text.match(
    /me\s+and\s+(?:my\s+)?(?:wife|husband|partner|parents?|mom|dad|mother|father|brother|sister|friend)/i,
  );
  if (duo) return "2 travellers";
  // Regex that requires an explicit number followed by a group word. This
  // avoids misreading "ages 32 and 30" as 32 travellers.
  const m = text.match(
    /(?:^|\s|passengers?\s*[=:]\s*)(\d+|one|two|three|four|five|six)\s*(?:of\s+(?:us|them|the group)|passengers?|adults?|people|persons?|travellers?|pax|kids?|children|members?)/i,
  );
  if (m) {
    const n = numberFromText(m[1]);
    return n ? `${n} travellers` : null;
  }
  // "with 2 kids" / "plus 3 friends"
  const withCount = text.match(
    /(?:with|plus|and)\s+(\d+)\s*(?:kids?|children|adults?|friends|people)/i,
  );
  if (withCount) return `${withCount[1]} travellers`;
  return null;
}

// "me, my husband, our two kids" — keeps the raw text, since names need a
// human to read them properly.
function sniffPassengerDetails(text: string): string | null {
  // Look for at least two capitalised name-looking tokens, OR a literal
  // "names:" prefix the traveller might use.
  if (/names?\s*[:\-]/i.test(text)) {
    return text.split(/[:\-]/i)[1]?.trim() ?? text;
  }
  // Names + ages: lines like "raskesh, 32" / "prakash, 42" without an
  // explicit "years" word. Capitalised name followed by comma and age.
  const nameAgeLines = text.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\s*,\s*\d{1,3}/g);
  if (nameAgeLines && nameAgeLines.length >= 1) {
    return nameAgeLines.map((line) => line.trim()).join("; ");
  }
  const nameLike = text.match(/\b([A-Z][a-z]{2,})(?:\s+[A-Z][a-z]{2,}){0,3}\b/g);
  if (nameLike && nameLike.length >= 1 && /(\baged?\b|\bage\b|\byears?\b|\byr\b)/i.test(text)) {
    return nameLike.join(", ");
  }
  return null;
}

function sniffEmail(text: string): string | null {
  const m = text.match(EMAIL_RE);
  return m ? m[0] : null;
}

// Apply a sniff result to the field map. If the field is already filled,
// the new value is appended (so the human team sees both). If the value
// could not be parsed, we set parsed=false so it is flagged as raw.
function setField(
  map: Record<string, CollectedField<string>>,
  key: string,
  value: string | null,
  parsed: boolean,
) {
  if (!value) return;
  const existing = map[key];
  if (existing) {
    // Avoid duplicating identical lines.
    if (existing.value.toLowerCase().includes(value.toLowerCase())) return;
    map[key] = { value: `${existing.value}; ${value}`, parsed: existing.parsed && parsed };
    return;
  }
  map[key] = { value, parsed };
}

function rawFallback(
  map: Record<string, CollectedField<string>>,
  phase: CollectorPhase,
  raw: string,
) {
  // If we couldn't structure-parse anything but the message clearly is a
  // continuation of the collector (the traveller answered our ask-all
  // with a wall of text), store the raw text in a dedicated notes bucket
  // rather than polluting a structured field like passengerCount or email.
  map._notes = { value: raw, parsed: false };
}

// Public entry point. Returns the updated collector data with whatever
// fields the latest message filled. Callers decide whether to escalate.
// When collectorExtractor is provided it is tried first; if it returns no
// usable fields or throws, the raw message is stored via rawFallback so
// the human team never loses a traveller's reply.
export async function extractCollectorFields(
  phase: CollectorPhase,
  prior: CollectorData | null | undefined,
  text: string,
  packageContext?: { name: string | null },
  collectorExtractor?: CollectorExtractor,
): Promise<CollectorData> {
  const map: Record<string, CollectedField<string>> = { ...(prior?.fields ?? {}) };

  // Build the ask-all text that triggered this phase. This is what the
  // bot asked, which gives the LLM the context to map the traveller's
  // free-text reply to the correct field keys.
  const askText = buildCollectorAskAll(phase, packageContext?.name ?? undefined);

  if (collectorExtractor) {
    try {
      const llmResult = await collectorExtractor({
        phase,
        askText,
        messageText: text,
        packageName: packageContext?.name ?? undefined,
      });

      const hasAnyValue = Object.values(llmResult.fields).some(
        (v) => v !== null && v.trim() !== "",
      );
      if (hasAnyValue) {
        for (const [key, value] of Object.entries(llmResult.fields)) {
          if (value && value.trim() !== "") {
            setField(map, key, value.trim(), true);
          }
        }
        // Preserve notes from prior if nothing new added.
        const notes = Object.keys(map).length === 0 ? text : (prior?.notes ?? undefined);
        return { fields: map, notes };
      }
    } catch {
      // LLM failed — fall through to rawFallback so the human team gets
      // the traveller's full reply regardless.
    }
  }

  // No LLM configured, or LLM returned nothing usable. Store the raw
  // message so the human team can read it.
  rawFallback(map, phase, text);
  return { fields: map, notes: text };
}

// Builds the "we still need X, Y, Z" follow-up. The 50% gate means most
// travellers see this once or twice before they qualify for the handoff.
export function buildFollowUp(
  phase: CollectorPhase,
  data: CollectorData | null | undefined,
): string {
  const missing = missingFields(phase, data);
  const intro =
    phase === "collecting_custom_package"
      ? "Thanks — I've sent what we have so far. To pass this to our team, please also share:"
      : "Thanks — I've sent what we have so far. To pass this booking to our team, please also share:";
  if (missing.length === 0) {
    return `${intro}\n\nWe have everything. We'll raise this to our team and get back to you shortly.`;
  }
  return [intro, "", ...missing.map((line, i) => `${i + 1}. ${line}`)].join("\n");
}

// Handoff message shown to the traveller at the moment the bot escalates.
// Acknowledges what was captured, names what's missing, and explicitly
// says the team is on it.
export function buildHandoffTravelerMessage(
  phase: CollectorPhase,
  data: CollectorData | null | undefined,
): string {
  const missing = missingFields(phase, data, 8);
  const filled = buildCollectorSummary(phase, data);
  const header =
    phase === "collecting_custom_package"
      ? "I've raised your custom trip request to our team. They'll get back to you shortly."
      : "I've raised your booking request to our team. They'll get back to you shortly.";
  const lines = [header, "", "Here's what we have so far:", "", filled];
  if (missing.length > 0) {
    lines.push("", "If you can share these remaining details, the team can respond faster:");
    for (const m of missing) lines.push(`- ${m}`);
  }
  return lines.join("\n");
}
