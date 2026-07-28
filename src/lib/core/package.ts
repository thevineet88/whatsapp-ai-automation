import { z } from "zod";

export const packageCategoryValues = [
  "spiritual",
  "beach",
  "adventure",
  "nature",
  "ladies_special",
  "parents_special",
] as const;
export const packageCategorySchema = z.enum(packageCategoryValues);
export type PackageCategory = z.infer<typeof packageCategorySchema>;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date as YYYY-MM-DD");

export const itineraryDaySchema = z.object({
  day: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().min(1),
  date: z.string().min(1).optional(),
  meals: z.string().min(1).optional(),
});
export type ItineraryDay = z.infer<typeof itineraryDaySchema>;

// Shared operational disclaimers that apply to every package unless a
// specific package overrides one; the default seed for a new package's
// points-to-note field.
export const STANDARD_POINTS_TO_NOTE = [
  "Group conduct and itinerary decisions during the trip are at the sole discretion of the tour manager.",
  "Itinerary is subject to change due to weather, road, or local authority conditions.",
  "Samyati Holidays' liability is limited to the services listed under Inclusions.",
  "Seating in vehicles is allotted by the tour manager and is not guaranteed by booking order.",
  "Personal expenses at stops (meals outside the itinerary, shopping, tips) are borne by the traveller.",
];

export const packageInputSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug must be lowercase-kebab-case"),
  category: z.array(packageCategorySchema).min(1),
  durationDays: z.number().int().positive(),
  durationNights: z.number().int().nonnegative(),
  highlights: z.array(z.string().min(1)).min(1),
  advisory: z.string().min(1),
  flightInformation: z.string().min(1).optional(),
  departurePoint: z.string().min(1),
  travelMode: z.string().min(1),
  returnPoint: z.string().min(1),
  itinerary: z.array(itineraryDaySchema).min(1),
  inclusions: z.array(z.string().min(1)).min(1),
  exclusions: z.array(z.string().min(1)).min(1),
  pointsToNote: z.array(z.string().min(1)).min(1),
});
export type PackageInput = z.infer<typeof packageInputSchema>;

export const batchInputSchema = z
  .object({
    departureDate: isoDateSchema,
    seatsTotal: z.number().int().positive(),
    seatsAvailable: z.number().int().nonnegative(),
    startingPricePaise: z.number().int().positive(),
    lastBookingDate: isoDateSchema.nullable(),
  })
  .refine((batch) => batch.seatsAvailable <= batch.seatsTotal, {
    message: "seatsAvailable cannot exceed seatsTotal",
    path: ["seatsAvailable"],
  });
export type BatchInput = z.infer<typeof batchInputSchema>;
