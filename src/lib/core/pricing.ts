import { z } from "zod";

// Business-standing rule, not a per-package setting: the first installment is
// never refundable, on any package, regardless of when a traveller cancels.
export const FIRST_INSTALLMENT_NON_REFUNDABLE_NOTE =
  "The first installment is non-refundable in all cases.";

export const paymentInstallmentInputSchema = z.object({
  sequence: z.number().int().positive(),
  label: z.string().min(1),
  amountPaise: z.number().int().positive(),
  dueBy: z.string().min(1),
});
export type PaymentInstallmentInput = z.infer<typeof paymentInstallmentInputSchema>;

export const cancellationRuleInputSchema = z.object({
  sequence: z.number().int().positive(),
  cutoff: z.string().min(1),
  deduction: z.string().min(1),
});
export type CancellationRuleInput = z.infer<typeof cancellationRuleInputSchema>;

export const priceVariantInputSchema = z.object({
  occupancyType: z.string().min(1),
  pricePaise: z.number().int().positive(),
});
export type PriceVariantInput = z.infer<typeof priceVariantInputSchema>;

// Default cancellation tiers a new package starts from; a package may
// override these, same as points-to-note.
export const STANDARD_CANCELLATION_POLICY: CancellationRuleInput[] = [
  { sequence: 1, cutoff: "45+ days before departure", deduction: "25% of package cost" },
  { sequence: 2, cutoff: "30-44 days before departure", deduction: "50% of package cost" },
  { sequence: 3, cutoff: "15-29 days before departure", deduction: "75% of package cost" },
  {
    sequence: 4,
    cutoff: "Less than 15 days before departure, or no-show",
    deduction: "100% of package cost",
  },
];
