import type { Db } from "@/lib/db/client";
import { conversations, messages, whatsappAccounts } from "@/lib/db/schema";
import { scopedDb } from "@/lib/db/scoped";
import type { WhatsAppInboundJob } from "@/lib/queue/whatsappInboundQueue";
import { type WhatsAppClient, createWhatsAppClient } from "@/lib/whatsapp/client";
import { eq } from "drizzle-orm";

export type EchoMessageDeps = {
  db: Db;
  createClient?: (accessToken: string, phoneNumberId: string) => WhatsAppClient;
};

export async function handleInboundMessage(
  deps: EchoMessageDeps,
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

  const accessToken = requireEnv("WHATSAPP_ACCESS_TOKEN");
  const client = createClient(accessToken, account.phoneNumberId);

  const replyBody = `You said: ${inboundContent}`;
  const result = await client.sendTextMessage(message.from, replyBody);

  if (!result.ok) {
    throw new Error(result.error);
  }

  await db.insert(messages).values({
    tenantId,
    conversationId: conversation.id,
    metaMessageId: result.metaMessageId,
    direction: "outbound",
    content: replyBody,
  });

  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, conversation.id));
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
