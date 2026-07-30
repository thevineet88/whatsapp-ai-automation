"use server";

import { tenantConfigInputSchema } from "@/lib/core/config";
import { tenants } from "@/lib/db/schema";
import { getServerDb } from "@/lib/db/serverDb";
import { createTenantConfigVersion, getActiveTenantConfig } from "@/lib/db/tenantConfig";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function parseContactsField(raw: string) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, phone] = line.split(",").map((part) => part.trim());
      return { name: name ?? "", phone: phone ?? "" };
    });
}

export async function updateTenantConfig(formData: FormData): Promise<void> {
  const raw = String(formData.get("escalationContacts") ?? "");
  const holdingReplyMessage = String(formData.get("holdingReplyMessage") ?? "").trim();

  const db = getServerDb();
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) {
    redirect("/config?error=No%20tenant%20found");
  }

  const adminPassword = String(formData.get("adminPassword") ?? "").trim();
  const existingConfig = await getActiveTenantConfig(db, tenant.id);
  const existingPassword = (existingConfig?.config as { adminPassword?: string } | undefined)
    ?.adminPassword;

  const parsed = tenantConfigInputSchema.safeParse({
    escalationContacts: parseContactsField(raw),
    holdingReplyMessage: holdingReplyMessage.length > 0 ? holdingReplyMessage : undefined,
    // Keep the existing password if the admin leaves the field blank; treat
    // the blank input as "no change" rather than "clear the password".
    adminPassword: adminPassword.length > 0 ? adminPassword : existingPassword,
  });

  if (!parsed.success) {
    redirect(
      `/config?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input")}`,
    );
  }

  await createTenantConfigVersion(db, tenant.id, parsed.data);

  revalidatePath("/config");
  redirect("/config?saved=1");
}
