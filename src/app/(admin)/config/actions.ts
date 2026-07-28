"use server";

import { tenantConfigInputSchema } from "@/lib/core/config";
import { tenants } from "@/lib/db/schema";
import { getServerDb } from "@/lib/db/serverDb";
import { createTenantConfigVersion } from "@/lib/db/tenantConfig";
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
  const parsed = tenantConfigInputSchema.safeParse({
    escalationContacts: parseContactsField(raw),
  });

  if (!parsed.success) {
    redirect(
      `/config?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input")}`,
    );
  }

  const db = getServerDb();
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) {
    redirect("/config?error=No%20tenant%20found");
  }

  await createTenantConfigVersion(db, tenant.id, parsed.data);

  revalidatePath("/config");
  redirect("/config?saved=1");
}
