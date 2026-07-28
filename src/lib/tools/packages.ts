import { packageCategorySchema } from "@/lib/core/package";
import type { Db } from "@/lib/db/client";
import { batches, packages } from "@/lib/db/schema";
import { and, asc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

/**
 * Deterministic, database-backed functions the LLM may call for package,
 * batch, and seat facts. No LLM involvement: prices, dates, and seat counts
 * must come from here, never be phrased into existence by a model.
 */

export const searchPackagesInputSchema = z.object({
  category: packageCategorySchema.optional(),
  month: z.number().int().min(1).max(12).optional(),
  region: z.string().min(1).optional(),
  durationDays: z.number().int().positive().optional(),
});
export type SearchPackagesInput = z.infer<typeof searchPackagesInputSchema>;

export async function searchPackages(db: Db, tenantId: string, input: SearchPackagesInput = {}) {
  const conditions = [eq(packages.tenantId, tenantId)];

  if (input.category) {
    conditions.push(eq(packages.category, input.category));
  }
  if (input.durationDays) {
    conditions.push(eq(packages.durationDays, input.durationDays));
  }
  if (input.region) {
    const term = `%${input.region}%`;
    const regionMatch = or(
      ilike(packages.name, term),
      ilike(packages.departurePoint, term),
      ilike(packages.returnPoint, term),
    );
    if (regionMatch) conditions.push(regionMatch);
  }
  if (input.month) {
    const packageIdsInMonth = db
      .select({ id: batches.packageId })
      .from(batches)
      .where(
        and(
          eq(batches.tenantId, tenantId),
          sql`extract(month from ${batches.departureDate}) = ${input.month}`,
        ),
      );
    conditions.push(inArray(packages.id, packageIdsInMonth));
  }

  return db
    .select()
    .from(packages)
    .where(and(...conditions))
    .orderBy(asc(packages.name));
}

export const listBatchesInputSchema = z.object({
  packageId: z.string().uuid(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type ListBatchesInput = z.infer<typeof listBatchesInputSchema>;

export type BatchWithAvailability = typeof batches.$inferSelect & { isFull: boolean };

export async function listBatches(
  db: Db,
  tenantId: string,
  input: ListBatchesInput,
): Promise<BatchWithAvailability[]> {
  const fromDate = input.fromDate ?? new Date().toISOString().slice(0, 10);

  const rows = await db
    .select()
    .from(batches)
    .where(
      and(
        eq(batches.tenantId, tenantId),
        eq(batches.packageId, input.packageId),
        gte(batches.departureDate, fromDate),
      ),
    )
    .orderBy(asc(batches.departureDate));

  return rows.map((batch) => ({ ...batch, isFull: batch.seatsAvailable <= 0 }));
}

export const checkSeatsInputSchema = z.object({ batchId: z.string().uuid() });
export type CheckSeatsInput = z.infer<typeof checkSeatsInputSchema>;

export type SeatAvailability = { batchId: string; seatsAvailable: number; isFull: boolean };

export async function checkSeats(
  db: Db,
  tenantId: string,
  input: CheckSeatsInput,
): Promise<SeatAvailability | null> {
  const [batch] = await db
    .select()
    .from(batches)
    .where(and(eq(batches.tenantId, tenantId), eq(batches.id, input.batchId)))
    .limit(1);

  if (!batch) return null;

  return {
    batchId: batch.id,
    seatsAvailable: batch.seatsAvailable,
    isFull: batch.seatsAvailable <= 0,
  };
}
