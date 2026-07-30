"use server";

import { checkAdminPassword } from "@/lib/admin/auth";
import { deleteAdminSession, setAdminSession } from "@/lib/admin/cookies";
import { conversations, escalations, messages, tenants, whatsappAccounts } from "@/lib/db/schema";
import { getServerDb } from "@/lib/db/serverDb";
import { getActiveTenantConfig } from "@/lib/db/tenantConfig";
import { createWhatsAppClient } from "@/lib/whatsapp/client";
import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// ─── Shared helpers ────────────────────────────────────────────────────────

export type AdminActionResult = { ok: true } | { ok: false; error: string };

async function getTenantContext() {
  const db = getServerDb();
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) throw new Error("No tenant found");
  const config = await getActiveTenantConfig(db, tenant.id);
  if (!config) throw new Error("No active tenant config");
  return { db, tenant, config };
}

// ─── Auth ──────────────────────────────────────────────────────────────────

export async function loginAdmin(formData: FormData): Promise<void> {
  const password = String(formData.get("password") ?? "");
  const { config } = await getTenantContext();

  if (!checkAdminPassword(config.config, password)) {
    throw new Error("Incorrect password");
  }

  await setAdminSession(password);
}

export async function logoutAdmin(): Promise<void> {
  await deleteAdminSession();
  revalidatePath("/admin", "layout");
}

// ─── Conversations list ────────────────────────────────────────────────────

export async function listConversations(status?: string) {
  const { db, tenant } = await getTenantContext();

  const validStatuses = ["open", "escalated", "awaiting_human", "human_active"] as const;
  const statusFilter = (validStatuses as readonly string[]).includes(status ?? "")
    ? (status as (typeof validStatuses)[number])
    : undefined;

  const rows = await db
    .select({
      id: conversations.id,
      travellerPhone: conversations.travellerPhone,
      status: conversations.status,
      lastMessageAt: conversations.lastMessageAt,
      createdAt: conversations.createdAt,
      pendingClarificationCount: conversations.pendingClarificationCount,
    })
    .from(conversations)
    .where(
      statusFilter
        ? and(eq(conversations.tenantId, tenant.id), eq(conversations.status, statusFilter))
        : eq(conversations.tenantId, tenant.id),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(100);

  // Attach the latest escalation reason and last message preview for each
  // conversation. Two queries per row keeps the SQL simple at the cost of
  // 100 extra roundtrips; the list is bounded and admin is a single human.
  return Promise.all(
    rows.map(async (conv) => {
      const [latestEscalation] = await db
        .select({ reason: escalations.reason, createdAt: escalations.createdAt })
        .from(escalations)
        .where(eq(escalations.conversationId, conv.id))
        .orderBy(desc(escalations.createdAt))
        .limit(1);

      const [latestMessage] = await db
        .select({ content: messages.content, direction: messages.direction })
        .from(messages)
        .where(eq(messages.conversationId, conv.id))
        .orderBy(desc(messages.createdAt))
        .limit(1);

      return {
        ...conv,
        escalationReason: latestEscalation?.reason ?? null,
        lastMessagePreview: latestMessage
          ? latestMessage.direction === "inbound"
            ? `Traveller: ${latestMessage.content.slice(0, 80)}`
            : `Bot: ${latestMessage.content.slice(0, 80)}`
          : "No messages",
      };
    }),
  );
}

// ─── Thread view ───────────────────────────────────────────────────────────

export async function getConversationThread(conversationId: string) {
  const { db, tenant } = await getTenantContext();

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenant.id)))
    .limit(1);

  if (!conversation) return null;

  const thread = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));

  // Pull every escalation for this conversation, newest first. Collector
  // requests (custom_package_request, booking_request) write their own
  // rows so the human team sees each ask-all → reply cycle as a separate
  // line item.
  const allEscalations = await db
    .select({
      id: escalations.id,
      reason: escalations.reason,
      detail: escalations.detail,
      severity: escalations.severity,
      status: escalations.status,
      createdAt: escalations.createdAt,
    })
    .from(escalations)
    .where(eq(escalations.conversationId, conversationId))
    .orderBy(desc(escalations.createdAt));

  return {
    conversation,
    thread,
    escalations: allEscalations,
  };
}

// ─── Take over ─────────────────────────────────────────────────────────────

export async function takeOverConversation(conversationId: string): Promise<AdminActionResult> {
  const { db, tenant } = await getTenantContext();

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenant.id)))
    .limit(1);

  if (!conversation) return { ok: false, error: "Conversation not found" };

  await db
    .update(conversations)
    .set({ status: "human_active" })
    .where(eq(conversations.id, conversationId));

  revalidatePath(`/admin/conversations/${conversationId}`);
  revalidatePath("/admin/conversations");
  return { ok: true };
}

// ─── Return to bot ───────────────────────────────────────────────────────────

export async function returnToBot(conversationId: string): Promise<AdminActionResult> {
  const { db, tenant } = await getTenantContext();

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenant.id)))
    .limit(1);

  if (!conversation) return { ok: false, error: "Conversation not found" };

  await db
    .update(conversations)
    .set({
      status: "open",
      // Returning the thread to the bot should also clear any stale
      // collector phase. If the admin had already collected some
      // information, it was attached to the escalation at the time; the
      // bot starting fresh is better than resuming a collection the
      // traveller may no longer be in.
      phase: null,
      collectorData: null,
    })
    .where(eq(conversations.id, conversationId));

  revalidatePath(`/admin/conversations/${conversationId}`);
  revalidatePath("/admin/conversations");
  return { ok: true };
}

// ─── Admin reply (send to WhatsApp) ─────────────────────────────────────────

export async function sendAdminReply(
  conversationId: string,
  formData: FormData,
): Promise<AdminActionResult> {
  const { db, tenant, config } = await getTenantContext();

  const text = String(formData.get("replyText") ?? "").trim();
  if (!text) return { ok: false, error: "Reply cannot be empty" };

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenant.id)))
    .limit(1);

  if (!conversation) return { ok: false, error: "Conversation not found" };

  const [account] = await db
    .select()
    .from(whatsappAccounts)
    .where(
      and(
        eq(whatsappAccounts.tenantId, tenant.id),
        eq(whatsappAccounts.id, conversation.whatsappAccountId),
      ),
    )
    .limit(1);

  if (!account) return { ok: false, error: "WhatsApp account not found" };

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) return { ok: false, error: "WHATSAPP_ACCESS_TOKEN not set" };

  const client = createWhatsAppClient({ accessToken, phoneNumberId: account.phoneNumberId });

  const sendResult = await client.sendTextMessage(conversation.travellerPhone, text);

  if (!sendResult.ok) {
    return { ok: false, error: `WhatsApp send failed: ${sendResult.error}` };
  }

  // Persist the outbound message. Written only after the send succeeded so
  // the transcript never claims the traveller was told something they never
  // received.
  await db.insert(messages).values({
    tenantId: tenant.id,
    conversationId: conversation.id,
    metaMessageId: sendResult.metaMessageId ?? undefined,
    direction: "outbound",
    content: text,
    isAdminReply: true,
  });

  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, conversation.id));

  revalidatePath(`/admin/conversations/${conversationId}`);
  return { ok: true };
}
