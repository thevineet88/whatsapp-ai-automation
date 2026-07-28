import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/lib/db/client";
import { createDb } from "../src/lib/db/client";
import { conversations, messages, whatsappAccounts } from "../src/lib/db/schema";
import { seedSamyati } from "../src/lib/db/seed";
import type { WhatsAppInboundJob } from "../src/lib/queue/whatsappInboundQueue";
import type { WhatsAppClient } from "../src/lib/whatsapp/client";
import { handleInboundMessage } from "../src/worker/handlers/echoMessage";

let container: StartedPostgreSqlContainer;
let db: Db;
let tenantId: string;
let whatsappAccountId: string;

function buildJob(messageId: string, overrides?: Partial<WhatsAppInboundJob["message"]>) {
  return {
    tenantId,
    whatsappAccountId,
    phoneNumberId: "samyati-dev-phone-number-id",
    message: {
      id: messageId,
      from: "919876543210",
      timestamp: "1700000000",
      type: "text",
      text: { body: "Hi, what packages do you have?" },
      ...overrides,
    },
  } satisfies WhatsAppInboundJob;
}

function stubClient(
  result: Awaited<ReturnType<WhatsAppClient["sendTextMessage"]>>,
): WhatsAppClient {
  return { sendTextMessage: async () => result };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  db = createDb(container.getConnectionUri());
  await migrate(db, { migrationsFolder: "./drizzle" });
  process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
}, 120_000);

afterAll(async () => {
  await db.$pool.end();
  await container.stop();
});

beforeEach(async () => {
  await db.execute(
    `truncate table "tenants", "whatsapp_accounts", "packages", "batches", "conversations", "messages" restart identity cascade`,
  );

  const tenant = await seedSamyati(db);
  tenantId = tenant.id;

  const [account] = await db
    .select()
    .from(whatsappAccounts)
    .where(eq(whatsappAccounts.tenantId, tenantId))
    .limit(1);
  whatsappAccountId = account.id;
});

describe("handleInboundMessage (echo bot)", () => {
  it("persists the inbound message and sends an echo reply", async () => {
    const job = buildJob("msg-echo-1");

    await handleInboundMessage(
      { db, createClient: () => stubClient({ ok: true, metaMessageId: "wamid.reply-1" }) },
      job,
    );

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.travellerPhone, job.message.from),
        ),
      );
    expect(conversation).toBeDefined();

    const conversationMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id));

    expect(conversationMessages).toHaveLength(2);

    const inbound = conversationMessages.find((m) => m.direction === "inbound");
    expect(inbound?.content).toBe("Hi, what packages do you have?");
    expect(inbound?.metaMessageId).toBe("msg-echo-1");

    const outbound = conversationMessages.find((m) => m.direction === "outbound");
    expect(outbound?.content).toBe("You said: Hi, what packages do you have?");
    expect(outbound?.metaMessageId).toBe("wamid.reply-1");
  });

  it("reuses the same conversation across messages from the same traveller", async () => {
    await handleInboundMessage(
      { db, createClient: () => stubClient({ ok: true, metaMessageId: "wamid.reply-1" }) },
      buildJob("msg-echo-a"),
    );
    await handleInboundMessage(
      { db, createClient: () => stubClient({ ok: true, metaMessageId: "wamid.reply-2" }) },
      buildJob("msg-echo-b"),
    );

    const matchingConversations = await db
      .select()
      .from(conversations)
      .where(
        and(eq(conversations.tenantId, tenantId), eq(conversations.travellerPhone, "919876543210")),
      );

    expect(matchingConversations).toHaveLength(1);
  });

  it("throws when the WhatsApp send fails, leaving the inbound message persisted", async () => {
    const job = buildJob("msg-echo-fail");

    await expect(
      handleInboundMessage(
        { db, createClient: () => stubClient({ ok: false, error: "whatsapp send failed: 500" }) },
        job,
      ),
    ).rejects.toThrow("whatsapp send failed");

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.tenantId, tenantId),
          eq(conversations.travellerPhone, job.message.from),
        ),
      );

    const conversationMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id));

    expect(conversationMessages).toHaveLength(1);
    expect(conversationMessages[0]?.direction).toBe("inbound");
  });
});
