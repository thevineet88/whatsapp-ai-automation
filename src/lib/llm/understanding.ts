import { type MessageUnderstanding, messageUnderstandingSchema } from "@/lib/core/understanding";
import { type Catalogue, renderCatalogueForPrompt } from "@/lib/router/catalogue";
import OpenAI from "openai";
import { z } from "zod";

// DeepSeek exposes only the OpenAI Chat Completions API. It supports the
// legacy json_object response format but not OpenAI's structured outputs
// (json_schema), so we ask for JSON, parse the model's response ourselves,
// and validate against the Zod schema before returning.
const UNDERSTANDING_MODEL = "deepseek-chat";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const UNDERSTANDING_TEMPERATURE = 0;

export const UNDERSTANDING_SYSTEM_PROMPT = `You are the message understanding layer for Samyati Holidays, a Mumbai and Pune group tour operator on WhatsApp.

Your only job is to interpret an incoming traveller message. You do NOT answer it. You do NOT state prices, dates, or seat counts. Another system does that from a database.

Return:

1. intent - what the traveller is asking:
- batches: departure dates, upcoming trips, seat availability
- price: cost, rates, how much
- inclusions_exclusions: what is or is not included
- itinerary: day by day plan
- best_season: best time to go, weather, climate
- departure_point: where the trip starts, pickup, boarding
- duration: how many days or nights
- installments: payment schedule, advance amount, EMI
- how_to_book: how the booking process works (NOT an actual request to book)
- cancellation_policy: cancellation or refund rules
- general_knowledge: any other factual question about a trip (permits, ID, connectivity, altitude, what to pack, food)
- package_overview: a trip is named with no specific question attached ("Rameshwaram trip?", "tell me about Sikkim", "Gokarna?"). Use this whenever they name a trip and want to know about it generally.
- greeting: hello, hi, thanks, ok, and other social messages
- browse_packages: asking what trips exist, or for a recommendation, WITHOUT naming a specific trip
- custom_package_request: the traveller wants a tailor-made trip (custom, personalised, honeymoon, etc.) that is not in the catalogue. DO NOT list packages here - this request is handled separately by the collector flow.
- booking_request: the traveller wants to actually book or register for a specific trip. "How do I book" is how_to_book; "I want to book this" is booking_request. USE booking_request ONLY when the message contains a clear booking verb ("book", "reserve", "register", "sign up", "confirm seat") OR the traveller is replying to a booking form. Naming a trip alone ("kedarnath trip", "tell me about X") is package_overview, NOT booking_request.
- other: anything that fits nothing above

If the message contains a second, different question, put it in secondaryIntent ("when is the Ayodhya trip and how much?" is intent=batches, secondaryIntent=price). Otherwise secondaryIntent is null.

2. packageId - the trip the message is about, using the catalogue below.
Resolve places, landmarks, regions and colloquial names to the trip that covers them. A traveller naming any place a trip visits means that trip. Consider the conversation history: if they asked about a trip earlier and now ask a follow up without naming it, keep that trip.
Use ONLY ids from the catalogue. If no trip clearly matches, use null.

3. packageCandidateIds - if the message could mean more than one trip, list those ids. Otherwise an empty array.

3b. namedUnrecognizedPlace - true if the traveller's message names a specific place, city, or trip that is NOT covered by any trip in the catalogue below (for example "Nashik trip?", "Dubai?", "any package for Manali?" when Manali is not listed). This must be true even if the question looks like an ordinary price/date/itinerary question ("price of Nashik trip" is still namedUnrecognizedPlace=true, packageId=null - do NOT fall back to a trip already being discussed just because the question shape matches one). False when the message names no place at all (a plain "how much?" or "and the price?" with nothing specific named), and false when the named place IS one of the catalogue's trips.

4. safetyFlags - these describe ONLY the new traveller message, never earlier ones. Earlier messages are context for resolving which trip is meant, nothing more. If a previous message raised a health or booking concern but the new message is an ordinary question, all flags stay false.
Set true when the NEW message involves:
- fitnessOrHealth: fitness, health, age suitability, children, senior citizens, pregnancy, injury, disability, altitude sickness, medication, or whether someone can manage the trip physically
- bookingOrPayment: the traveller wants to actually book, reserve or confirm a seat, make a payment, or get a refund. Asking what a trip costs, what the installments are, or how booking works in general is NOT this: those are ordinary questions, answered from data.
- complaintOrSafety: a complaint, a safety concern, damage, or an accusation
- humanRequest: asking to speak to a person or a named staff member
Within the boundaries above, err toward true: a missed flag is worse than an unnecessary handoff. But do not flag an ordinary informational question just because it is about money or about a person's trip.

5. needsHuman - true if the NEW message itself needs a person for any other reason. Do not set it merely because a teammate is already handling something earlier in the thread.

6. confidence - 0 to 1, how sure you are about intent and packageId.

CATALOGUE:
`;

export type UnderstandingInput = {
  message: string;
  // Most recent turns, oldest first, so follow ups like "and the price?"
  // resolve against what was already being discussed.
  history: { role: "traveller" | "bot"; content: string }[];
  anchoredPackageId: string | null;
  catalogue: Catalogue;
};

export type UnderstandingClassifier = (input: UnderstandingInput) => Promise<UnderstandingOutput>;

export function buildUnderstandingPrompt(input: UnderstandingInput): string {
  const history =
    input.history.length > 0
      ? input.history.map((turn) => `${turn.role}: ${turn.content}`).join("\n")
      : "(no earlier messages)";

  const anchor = input.anchoredPackageId
    ? `Trip already under discussion: ${input.anchoredPackageId}`
    : "No trip is anchored yet in this conversation.";

  return `Conversation so far:
${history}

${anchor}

New traveller message: "${input.message}"`;
}

export type UnderstandingOutput = {
  understanding: MessageUnderstanding;
  usage: {
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
  };
};

export function createDeepSeekUnderstandingClassifier(apiKey: string): UnderstandingClassifier {
  const client = new OpenAI({
    apiKey,
    baseURL: DEEPSEEK_BASE_URL,
  });
  return async (input) => {
    const completion = await client.chat.completions.create({
      model: UNDERSTANDING_MODEL,
      temperature: UNDERSTANDING_TEMPERATURE,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            UNDERSTANDING_SYSTEM_PROMPT +
            renderCatalogueForPrompt(input.catalogue) +
            "\n\nRespond with a single JSON object matching this schema: " +
            JSON.stringify(z.toJSONSchema(messageUnderstandingSchema)) +
            "\nDo not include any prose, explanation, or markdown fences around the JSON.",
        },
        { role: "user", content: buildUnderstandingPrompt(input) },
      ],
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("DeepSeek returned no understanding content");
    const parsed = messageUnderstandingSchema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      throw new Error("DeepSeek understanding failed schema validation: " + parsed.error.message);
    }
    const usage = completion.usage;
    return {
      understanding: parsed.data,
      usage: {
        model: UNDERSTANDING_MODEL,
        inputTokens: usage?.prompt_tokens ?? null,
        outputTokens: usage?.completion_tokens ?? null,
      },
    };
  };
}