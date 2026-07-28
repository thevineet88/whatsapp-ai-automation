"use server";

import { batchInputSchema } from "@/lib/core/package";
import { type PriceVariantInput, priceVariantInputSchema } from "@/lib/core/pricing";
import { batchPriceVariants, batches, tenants } from "@/lib/db/schema";
import { getServerDb } from "@/lib/db/serverDb";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

function parseBatchForm(formData: FormData): unknown {
  return {
    departureDate: String(formData.get("departureDate") ?? ""),
    seatsTotal: Number(formData.get("seatsTotal")),
    seatsAvailable: Number(formData.get("seatsAvailable")),
    startingPricePaise: Number(formData.get("startingPricePaise")),
    lastBookingDate: String(formData.get("lastBookingDate") ?? ""),
  };
}

const priceVariantsSchema = z.array(priceVariantInputSchema);

function parsePriceVariants(raw: string): PriceVariantInput[] | null {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const parsed = lines.map((line) => {
    const [occupancyType, pricePaise] = line.split(":").map((part) => part?.trim() ?? "");
    return { occupancyType, pricePaise: Number(pricePaise) };
  });

  const result = priceVariantsSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export async function createBatch(packageId: string, formData: FormData): Promise<void> {
  const parsed = batchInputSchema.safeParse(parseBatchForm(formData));
  const variants = parsePriceVariants(String(formData.get("priceVariants") ?? ""));

  if (!parsed.success || variants === null) {
    redirect(
      `/packages/${packageId}/batches?error=${encodeURIComponent(parsed.success ? "Invalid room-type prices (format: occupancy:pricePaise)" : (parsed.error.issues[0]?.message ?? "Invalid input"))}`,
    );
  }

  const db = getServerDb();
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) {
    redirect(`/packages/${packageId}/batches?error=No%20tenant%20found`);
  }

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(batches)
      .values({ tenantId: tenant.id, packageId, ...parsed.data })
      .returning();
    if (variants.length > 0) {
      await tx
        .insert(batchPriceVariants)
        .values(
          variants.map((variant) => ({ tenantId: tenant.id, batchId: created.id, ...variant })),
        );
    }
  });

  revalidatePath(`/packages/${packageId}/batches`);
  redirect(`/packages/${packageId}/batches`);
}

export async function updateBatch(
  packageId: string,
  batchId: string,
  formData: FormData,
): Promise<void> {
  const parsed = batchInputSchema.safeParse(parseBatchForm(formData));
  const variants = parsePriceVariants(String(formData.get("priceVariants") ?? ""));

  if (!parsed.success || variants === null) {
    redirect(
      `/packages/${packageId}/batches?error=${encodeURIComponent(parsed.success ? "Invalid room-type prices (format: occupancy:pricePaise)" : (parsed.error.issues[0]?.message ?? "Invalid input"))}`,
    );
  }

  const db = getServerDb();
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) {
    redirect(`/packages/${packageId}/batches?error=No%20tenant%20found`);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(batches)
      .set(parsed.data)
      .where(and(eq(batches.id, batchId), eq(batches.tenantId, tenant.id)));

    await tx.delete(batchPriceVariants).where(eq(batchPriceVariants.batchId, batchId));
    if (variants.length > 0) {
      await tx
        .insert(batchPriceVariants)
        .values(variants.map((variant) => ({ tenantId: tenant.id, batchId, ...variant })));
    }
  });

  revalidatePath(`/packages/${packageId}/batches`);
  redirect(`/packages/${packageId}/batches?saved=1`);
}

export async function deleteBatch(packageId: string, batchId: string): Promise<void> {
  const db = getServerDb();
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) {
    redirect(`/packages/${packageId}/batches?error=No%20tenant%20found`);
  }

  await db.transaction(async (tx) => {
    await tx.delete(batchPriceVariants).where(eq(batchPriceVariants.batchId, batchId));
    await tx.delete(batches).where(and(eq(batches.id, batchId), eq(batches.tenantId, tenant.id)));
  });

  revalidatePath(`/packages/${packageId}/batches`);
  redirect(`/packages/${packageId}/batches`);
}
