"use server";

import { cancellationRuleInputSchema, paymentInstallmentInputSchema } from "@/lib/core/pricing";
import { cancellationRules, paymentInstallments, tenants } from "@/lib/db/schema";
import { getServerDb } from "@/lib/db/serverDb";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function requireTenantOrRedirect(packageId: string) {
  const db = getServerDb();
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) {
    redirect(`/packages/${packageId}/payment-schedule?error=No%20tenant%20found`);
  }
  return { db, tenant };
}

export async function addInstallment(packageId: string, formData: FormData): Promise<void> {
  const parsed = paymentInstallmentInputSchema.safeParse({
    sequence: Number(formData.get("sequence")),
    label: String(formData.get("label") ?? "").trim(),
    amountPaise: Number(formData.get("amountPaise")),
    dueBy: String(formData.get("dueBy") ?? "").trim(),
  });

  if (!parsed.success) {
    redirect(
      `/packages/${packageId}/payment-schedule?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input")}`,
    );
  }

  const { db, tenant } = await requireTenantOrRedirect(packageId);

  try {
    await db.insert(paymentInstallments).values({ tenantId: tenant.id, packageId, ...parsed.data });
  } catch {
    redirect(
      `/packages/${packageId}/payment-schedule?error=Could%20not%20save%20installment%20%28sequence%20may%20already%20exist%29`,
    );
  }

  revalidatePath(`/packages/${packageId}/payment-schedule`);
  redirect(`/packages/${packageId}/payment-schedule`);
}

export async function deleteInstallment(packageId: string, installmentId: string): Promise<void> {
  const { db, tenant } = await requireTenantOrRedirect(packageId);

  await db
    .delete(paymentInstallments)
    .where(
      and(eq(paymentInstallments.id, installmentId), eq(paymentInstallments.tenantId, tenant.id)),
    );

  revalidatePath(`/packages/${packageId}/payment-schedule`);
  redirect(`/packages/${packageId}/payment-schedule`);
}

export async function addCancellationRule(packageId: string, formData: FormData): Promise<void> {
  const parsed = cancellationRuleInputSchema.safeParse({
    sequence: Number(formData.get("sequence")),
    cutoff: String(formData.get("cutoff") ?? "").trim(),
    deduction: String(formData.get("deduction") ?? "").trim(),
  });

  if (!parsed.success) {
    redirect(
      `/packages/${packageId}/payment-schedule?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input")}`,
    );
  }

  const { db, tenant } = await requireTenantOrRedirect(packageId);

  try {
    await db.insert(cancellationRules).values({ tenantId: tenant.id, packageId, ...parsed.data });
  } catch {
    redirect(
      `/packages/${packageId}/payment-schedule?error=Could%20not%20save%20rule%20%28sequence%20may%20already%20exist%29`,
    );
  }

  revalidatePath(`/packages/${packageId}/payment-schedule`);
  redirect(`/packages/${packageId}/payment-schedule`);
}

export async function deleteCancellationRule(packageId: string, ruleId: string): Promise<void> {
  const { db, tenant } = await requireTenantOrRedirect(packageId);

  await db
    .delete(cancellationRules)
    .where(and(eq(cancellationRules.id, ruleId), eq(cancellationRules.tenantId, tenant.id)));

  revalidatePath(`/packages/${packageId}/payment-schedule`);
  redirect(`/packages/${packageId}/payment-schedule`);
}
