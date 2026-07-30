import { DEFAULT_HOLDING_REPLY, type TenantConfigInput } from "@/lib/core/config";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { tenantConfigs } from "./schema";

export async function getActiveTenantConfig(db: Db, tenantId: string) {
  const [row] = await db
    .select()
    .from(tenantConfigs)
    .where(and(eq(tenantConfigs.tenantId, tenantId), eq(tenantConfigs.isActive, true)))
    .orderBy(desc(tenantConfigs.version))
    .limit(1);
  return row ?? null;
}

export function getHoldingReplyMessage(
  config: Pick<typeof tenantConfigs.$inferSelect, "config"> | null,
): string {
  const value = config?.config?.holdingReplyMessage;
  return typeof value === "string" && value.length > 0 ? value : DEFAULT_HOLDING_REPLY;
}

/**
 * Config rows are immutable and version-pinned: this writes a new version and
 * deactivates whatever was previously active, rather than updating in place,
 * so a bad edit is a rollback (deactivate the new row) not a lost history.
 */
export async function createTenantConfigVersion(
  db: Db,
  tenantId: string,
  input: TenantConfigInput,
) {
  return db.transaction(async (tx) => {
    const [previous] = await tx
      .select()
      .from(tenantConfigs)
      .where(and(eq(tenantConfigs.tenantId, tenantId), eq(tenantConfigs.isActive, true)))
      .orderBy(desc(tenantConfigs.version))
      .limit(1);

    if (previous) {
      await tx
        .update(tenantConfigs)
        .set({ isActive: false })
        .where(eq(tenantConfigs.id, previous.id));
    }

    const [created] = await tx
      .insert(tenantConfigs)
      .values({
        tenantId,
        version: (previous?.version ?? 0) + 1,
        escalationContacts: input.escalationContacts,
        config: {
          holdingReplyMessage: input.holdingReplyMessage,
          ...(input.adminPassword ? { adminPassword: input.adminPassword } : {}),
        },
        isActive: true,
      })
      .returning();

    return created;
  });
}
