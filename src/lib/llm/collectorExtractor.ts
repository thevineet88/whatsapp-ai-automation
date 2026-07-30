import OpenAI from "openai";
import { z } from "zod";

// DeepSeek exposes only the OpenAI Chat Completions API. It supports the
// legacy json_object response format but not OpenAI's structured outputs
// (json_schema), so we ask for JSON, parse the model's response ourselves,
// and validate against the Zod schema before returning.
const EXTRACTOR_MODEL = "deepseek-chat";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const EXTRACTOR_TEMPERATURE = 0;

// Booking collector: the human team needs these exact fields to action a
// booking request. The model maps the traveller's free-text reply to each
// field key. null means the field was not mentioned.
const bookingFieldsSchema = z.object({
  passengerCount: z.string().nullable().describe("Number of passengers, e.g. '2 travellers'"),
  passengerDetails: z.string().nullable().describe("Names and ages of each passenger, raw text"),
  contactEmail: z.string().nullable().describe("Email address"),
  roomSharing: z.string().nullable().describe("Room sharing preference: single, twin, triple, family room, etc."),
  trainVariant: z.string().nullable().describe("Train or flight preference: AC class, sleeper, flight, etc."),
  pickupCity: z.string().nullable().describe("City they will board from"),
  specialRequests: z.string().nullable().describe("Any special requests: meals, accessibility, rooming, etc."),
});

// Custom package collector: the human team needs these fields to design a
// tailor-made trip.
const customPackageFieldsSchema = z.object({
  destination: z.string().nullable().describe("Where they want to go: city, region, or country"),
  duration: z.string().nullable().describe("Duration, e.g. '5 days / 4 nights'"),
  travellers: z.string().nullable().describe("How many travellers and their ages"),
  dates: z.string().nullable().describe("Preferred travel month or specific dates"),
  budget: z.string().nullable().describe("Approximate budget per person"),
  tripType: z.string().nullable().describe("What kind of trip: honeymoon, family, friends, corporate, solo, other"),
  departureCity: z.string().nullable().describe("Which city they will travel from"),
  specialRequirements: z.string().nullable().describe("Special requirements: room preferences, dietary, mobility, sights"),
});

export type CollectorExtractorInput = {
  phase: "collecting_booking" | "collecting_custom_package";
  askText: string;
  messageText: string;
  packageName?: string;
};

export type CollectorExtractorOutput = {
  fields: Record<string, string | null>;
};

export type CollectorExtractor = (input: CollectorExtractorInput) => Promise<CollectorExtractorOutput>;

const EXTRACTOR_SYSTEM_PROMPT = `You are extracting structured booking and trip-planning fields from a traveller's free-text reply on WhatsApp.

The bot previously asked these questions:
{askText}

The traveller replied with this message:
{messageText}

{packageContext}

Your job: map whatever they wrote to the correct field keys. Rules:
- They may answer in any order, skip fields, make typos, use abbreviations.
- If a field is clearly present, extract it. If not mentioned, set it to null.
- Do NOT invent values for fields they did not provide.
- For names and ages, return the raw text as-is (e.g. "Raskesh 32, Prakash 42"). A human will read it.
- For passenger count, return a count string like "2 travellers".
- For room sharing, normalise common typos (singel -> single, famil -> family room).
- For train/flight preference, capture whatever they said (AC, sleeper, flight, etc.).
- For email, capture the full email address exactly.
- For budget, capture the amount with currency if present (e.g. "Rs 10,000 per person" or "$500 each").
- For duration, return "X days / Y nights" format.
- For dates, return month names or date ranges as they said them.
- For trip type, normalise to one of: honeymoon, family, friends, corporate, solo, other.

Return a single JSON object with these keys and string or null values. Do not include any prose, explanation, or markdown fences around the JSON.`;

function buildExtractorPrompt(input: CollectorExtractorInput): string {
  const packageContext =
    input.phase === "collecting_booking" && input.packageName
      ? `\nThis is a booking request for: ${input.packageName}. Do NOT extract the package name from the message; it is already known.\n`
      : "";
  const prompt = EXTRACTOR_SYSTEM_PROMPT
    .replace("{askText}", input.askText)
    .replace("{messageText}", input.messageText)
    .replace("{packageContext}", packageContext);

  const schema =
    input.phase === "collecting_booking" ? bookingFieldsSchema : customPackageFieldsSchema;

  return (
    prompt +
    "\n\nRespond with a single JSON object matching this schema: " +
    JSON.stringify(z.toJSONSchema(schema)) +
    "\nDo not include any prose, explanation, or markdown fences around the JSON."
  );
}

export function createDeepSeekCollectorExtractor(apiKey: string): CollectorExtractor {
  const client = new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL });

  return async (input): Promise<CollectorExtractorOutput> => {
    const schema =
      input.phase === "collecting_booking" ? bookingFieldsSchema : customPackageFieldsSchema;

    const completion = await client.chat.completions.create({
      model: EXTRACTOR_MODEL,
      temperature: EXTRACTOR_TEMPERATURE,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildExtractorPrompt(input) },
        { role: "user", content: input.messageText },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("DeepSeek returned no collector extraction content");
    }

    const parsed = schema.safeParse(JSON.parse(content));
    if (!parsed.success) {
      throw new Error("DeepSeek collector extraction failed schema validation: " + parsed.error.message);
    }

    return { fields: parsed.data };
  };
}
