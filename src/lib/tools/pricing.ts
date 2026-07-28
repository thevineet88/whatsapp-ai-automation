import { FIRST_INSTALLMENT_NON_REFUNDABLE_NOTE } from "@/lib/core/pricing";
import type { Db } from "@/lib/db/client";
import {
  batchPriceVariants,
  batches,
  cancellationRules,
  paymentInstallments,
} from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

/**
 * Deterministic, database-backed price and payment-schedule lookups. Pure
 * functions over stored rows: no LLM involvement, per the invariant that
 * prices, installment amounts, and cancellation terms are never generated.
 */

export const getPriceInputSchema = z.object({ batchId: z.string().uuid() });
export type GetPriceInput = z.infer<typeof getPriceInputSchema>;

export type PriceQuote = {
  batchId: string;
  startingPricePaise: number;
  variants: { occupancyType: string; pricePaise: number }[];
};

export async function getPrice(
  db: Db,
  tenantId: string,
  input: GetPriceInput,
): Promise<PriceQuote | null> {
  const [batch] = await db
    .select()
    .from(batches)
    .where(and(eq(batches.tenantId, tenantId), eq(batches.id, input.batchId)))
    .limit(1);

  if (!batch) return null;

  const variantRows = await db
    .select()
    .from(batchPriceVariants)
    .where(and(eq(batchPriceVariants.tenantId, tenantId), eq(batchPriceVariants.batchId, batch.id)))
    .orderBy(asc(batchPriceVariants.pricePaise));

  return {
    batchId: batch.id,
    startingPricePaise: batch.startingPricePaise,
    variants: variantRows.map((row) => ({
      occupancyType: row.occupancyType,
      pricePaise: row.pricePaise,
    })),
  };
}

export const getPaymentScheduleInputSchema = z.object({ packageId: z.string().uuid() });
export type GetPaymentScheduleInput = z.infer<typeof getPaymentScheduleInputSchema>;

export type PaymentSchedule = {
  packageId: string;
  installments: { sequence: number; label: string; amountPaise: number; dueBy: string }[];
  cancellationPolicy: { sequence: number; cutoff: string; deduction: string }[];
  note: string;
};

export async function getPaymentSchedule(
  db: Db,
  tenantId: string,
  input: GetPaymentScheduleInput,
): Promise<PaymentSchedule> {
  const installmentRows = await db
    .select()
    .from(paymentInstallments)
    .where(
      and(
        eq(paymentInstallments.tenantId, tenantId),
        eq(paymentInstallments.packageId, input.packageId),
      ),
    )
    .orderBy(asc(paymentInstallments.sequence));

  const cancellationRows = await db
    .select()
    .from(cancellationRules)
    .where(
      and(
        eq(cancellationRules.tenantId, tenantId),
        eq(cancellationRules.packageId, input.packageId),
      ),
    )
    .orderBy(asc(cancellationRules.sequence));

  return {
    packageId: input.packageId,
    installments: installmentRows.map((row) => ({
      sequence: row.sequence,
      label: row.label,
      amountPaise: row.amountPaise,
      dueBy: row.dueBy,
    })),
    cancellationPolicy: cancellationRows.map((row) => ({
      sequence: row.sequence,
      cutoff: row.cutoff,
      deduction: row.deduction,
    })),
    note: FIRST_INSTALLMENT_NON_REFUNDABLE_NOTE,
  };
}
