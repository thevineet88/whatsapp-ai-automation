"use server";

import { type PackageInput, packageInputSchema } from "@/lib/core/package";
import {
  batchPriceVariants,
  batches,
  cancellationRules,
  packages,
  paymentInstallments,
  tenants,
} from "@/lib/db/schema";
import { getServerDb } from "@/lib/db/serverDb";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function linesOf(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseItinerary(raw: string): PackageInput["itinerary"] {
  return linesOf(raw).map((line) => {
    const [dayPart, title, description] = line.split("|").map((part) => part?.trim() ?? "");
    return { day: Number(dayPart), title: title ?? "", description: description ?? "" };
  });
}

function parsePackageForm(formData: FormData): unknown {
  const flightInformation = String(formData.get("flightInformation") ?? "").trim();
  return {
    name: String(formData.get("name") ?? "").trim(),
    slug: String(formData.get("slug") ?? "").trim(),
    category: formData.getAll("category").map(String),
    durationDays: Number(formData.get("durationDays")),
    durationNights: Number(formData.get("durationNights")),
    highlights: linesOf(String(formData.get("highlights") ?? "")),
    advisory: String(formData.get("advisory") ?? "").trim(),
    flightInformation: flightInformation.length > 0 ? flightInformation : undefined,
    departurePoint: String(formData.get("departurePoint") ?? "").trim(),
    travelMode: String(formData.get("travelMode") ?? "").trim(),
    returnPoint: String(formData.get("returnPoint") ?? "").trim(),
    itinerary: parseItinerary(String(formData.get("itinerary") ?? "")),
    inclusions: linesOf(String(formData.get("inclusions") ?? "")),
    exclusions: linesOf(String(formData.get("exclusions") ?? "")),
    pointsToNote: linesOf(String(formData.get("pointsToNote") ?? "")),
  };
}

export async function createPackage(formData: FormData): Promise<void> {
  const parsed = packageInputSchema.safeParse(parsePackageForm(formData));

  if (!parsed.success) {
    redirect(
      `/packages/new?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input")}`,
    );
  }

  const db = getServerDb();
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) {
    redirect("/packages/new?error=No%20tenant%20found");
  }

  try {
    await db.insert(packages).values({ tenantId: tenant.id, ...parsed.data });
  } catch {
    redirect(
      "/packages/new?error=Could%20not%20save%20package%20%28slug%20may%20already%20exist%29",
    );
  }

  revalidatePath("/packages");
  redirect("/packages");
}

export async function updatePackage(packageId: string, formData: FormData): Promise<void> {
  const parsed = packageInputSchema.safeParse(parsePackageForm(formData));

  if (!parsed.success) {
    redirect(
      `/packages/${packageId}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input")}`,
    );
  }

  const db = getServerDb();
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) {
    redirect(`/packages/${packageId}?error=No%20tenant%20found`);
  }

  try {
    await db
      .update(packages)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(packages.id, packageId), eq(packages.tenantId, tenant.id)));
  } catch {
    redirect(`/packages/${packageId}?error=Could%20not%20save%20package`);
  }

  revalidatePath("/packages");
  revalidatePath(`/packages/${packageId}`);
  redirect(`/packages/${packageId}?saved=1`);
}

export async function deletePackage(packageId: string): Promise<void> {
  const db = getServerDb();
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) {
    redirect("/packages?error=No%20tenant%20found");
  }

  await db.transaction(async (tx) => {
    const packageBatches = await tx
      .select({ id: batches.id })
      .from(batches)
      .where(and(eq(batches.packageId, packageId), eq(batches.tenantId, tenant.id)));
    const batchIds = packageBatches.map((batch) => batch.id);

    if (batchIds.length > 0) {
      await tx.delete(batchPriceVariants).where(inArray(batchPriceVariants.batchId, batchIds));
    }
    await tx
      .delete(batches)
      .where(and(eq(batches.packageId, packageId), eq(batches.tenantId, tenant.id)));
    await tx
      .delete(paymentInstallments)
      .where(
        and(
          eq(paymentInstallments.packageId, packageId),
          eq(paymentInstallments.tenantId, tenant.id),
        ),
      );
    await tx
      .delete(cancellationRules)
      .where(
        and(eq(cancellationRules.packageId, packageId), eq(cancellationRules.tenantId, tenant.id)),
      );
    await tx
      .delete(packages)
      .where(and(eq(packages.id, packageId), eq(packages.tenantId, tenant.id)));
  });

  revalidatePath("/packages");
  redirect("/packages");
}
