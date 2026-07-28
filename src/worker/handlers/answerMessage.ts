import type { Db } from "@/lib/db/client";
import { conversations, escalations, messages, whatsappAccounts } from "@/lib/db/schema";
import { scopedDb } from "@/lib/db/scoped";
import { getActiveTenantConfig, getHoldingReplyMessage } from "@/lib/db/tenantConfig";
import type { WhatsAppInboundJob } from "@/lib/queue/whatsappInboundQueue";
import { routeMessage } from "@/lib/router/route";
import { type WhatsAppClient, createWhatsAppClient } from "@/lib/whatsapp/client";
import { eq } from "drizzle-orm";

export type AnswerMessageDeps = {
  db: Db;
  createClient?: (accessToken: string, phoneNumberId: string) => WhatsAppClient;
};

export async function handleInboundMessage(
  deps: AnswerMessageDeps,
  job: WhatsAppInboundJob,
): Promise<void> {
  const { db, createClient = defaultCreateClient } = deps;
  const { tenantId, whatsappAccountId, message } = job;

  const [account] = await db
    .select()
    .from(whatsappAccounts)
    .where(eq(whatsappAccounts.id, whatsappAccountId))
    .limit(1);

  if (!account || account.tenantId !== tenantId) {
    throw new Error(`whatsapp account not found for tenant: ${whatsappAccountId}`);
  }

  const scoped = scopedDb(db, tenantId);
  const [existingConversation] = await scoped.conversations.findMany(
    eq(conversations.travellerPhone, message.from),
  );

  const conversation =
    existingConversation ??
    (
      await db
        .insert(conversations)
        .values({ tenantId, whatsappAccountId, travellerPhone: message.from })
        .returning()
    )[0];

  const inboundContent = message.text?.body ?? `[unsupported message type: ${message.type}]`;

  await db.insert(messages).values({
    tenantId,
    conversationId: conversation.id,
    metaMessageId: message.id,
    direction: "inbound",
    content: inboundContent,
  });

  const activeConfig = await getActiveTenantConfig(db, tenantId);
  const holdingReplyMessage = getHoldingReplyMessage(activeConfig);

  const result = await routeMessage(
    db,
    tenantId,
    {
      packageId: conversation.packageId,
      pendingClarificationCount: conversation.pendingClarificationCount,
      status: conversation.status,
    },
    holdingReplyMessage,
    inboundContent,
  );

  if (result.replyText !== null) {
    const accessToken = requireEnv("WHATSAPP_ACCESS_TOKEN");
    const client = createClient(accessToken, account.phoneNumberId);
    const sendResult = await client.sendTextMessage(message.from, result.replyText);

    if (!sendResult.ok) {
      throw new Error(sendResult.error);
    }

    await db.insert(messages).values({
      tenantId,
      conversationId: conversation.id,
      metaMessageId: sendResult.metaMessageId,
      direction: "outbound",
      content: result.replyText,
    });
  }

  if (result.escalateReason) {
    await db.insert(escalations).values({
      tenantId,
      conversationId: conversation.id,
      reason: result.escalateReason,
      status: "pending",
    });

    // Escalation contacts are notified from here for visibility until the
    // admin panel gets a proper escalation queue (step 11); WhatsApp
    // business-initiated messages to them require a template outside the
    // 24h session window, which isn't built yet.
    console.error("whatsapp router: escalation raised", {
      tenantId,
      conversationId: conversation.id,
      reason: result.escalateReason,
      travellerPhone: maskPhone(message.from),
      escalationContacts: activeConfig?.escalationContacts.map((c) => c.name) ?? [],
    });
  }

  await db
    .update(conversations)
    .set({
      packageId: result.nextPackageId,
      pendingClarificationCount: result.nextPendingClarificationCount,
      status: result.escalateReason ? "escalated" : conversation.status,
      lastMessageAt: new Date(),
    })
    .where(eq(conversations.id, conversation.id));
}

function maskPhone(phone: string): string {
  return phone.length <= 4 ? "****" : `****${phone.slice(-4)}`;
}

function defaultCreateClient(accessToken: string, phoneNumberId: string): WhatsAppClient {
  return createWhatsAppClient({ accessToken, phoneNumberId });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}
