import { type SQL, and, eq } from "drizzle-orm";
import type { Db } from "./client";
import {
  batches,
  conversations,
  escalations,
  knowledgeChunks,
  messages,
  packages,
  tenantConfigs,
  whatsappAccounts,
} from "./schema";

/**
 * Every accessor below bakes `eq(table.tenantId, tenantId)` into the where
 * clause so a caller cannot query a tenant-scoped table without a tenant
 * filter. There is no unscoped escape hatch on this object; if a query needs
 * to cross tenants, it must go through `db` directly, not through this
 * helper, which makes that choice visible in a diff.
 */
export function scopedDb(db: Db, tenantId: string) {
  return {
    whatsappAccounts: {
      findMany: (extra?: SQL) =>
        db
          .select()
          .from(whatsappAccounts)
          .where(and(eq(whatsappAccounts.tenantId, tenantId), extra)),
    },
    conversations: {
      findMany: (extra?: SQL) =>
        db
          .select()
          .from(conversations)
          .where(and(eq(conversations.tenantId, tenantId), extra)),
    },
    messages: {
      findMany: (extra?: SQL) =>
        db
          .select()
          .from(messages)
          .where(and(eq(messages.tenantId, tenantId), extra)),
    },
    packages: {
      findMany: (extra?: SQL) =>
        db
          .select()
          .from(packages)
          .where(and(eq(packages.tenantId, tenantId), extra)),
    },
    batches: {
      findMany: (extra?: SQL) =>
        db
          .select()
          .from(batches)
          .where(and(eq(batches.tenantId, tenantId), extra)),
    },
    knowledgeChunks: {
      findMany: (extra?: SQL) =>
        db
          .select()
          .from(knowledgeChunks)
          .where(and(eq(knowledgeChunks.tenantId, tenantId), extra)),
    },
    tenantConfigs: {
      findMany: (extra?: SQL) =>
        db
          .select()
          .from(tenantConfigs)
          .where(and(eq(tenantConfigs.tenantId, tenantId), extra)),
    },
    escalations: {
      findMany: (extra?: SQL) =>
        db
          .select()
          .from(escalations)
          .where(and(eq(escalations.tenantId, tenantId), extra)),
    },
  };
}

export type ScopedDb = ReturnType<typeof scopedDb>;
