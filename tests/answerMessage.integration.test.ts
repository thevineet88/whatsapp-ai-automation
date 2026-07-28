import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/lib/db/client";
import { createDb } from "../src/lib/db/client";
import {
  batches,
  conversations,
  escalations,
  messages,
  packages,
  whatsappAccounts,
} from "../src/lib/db/schema";
import { seedSamyati } from "../src/lib/db/seed";
import type { WhatsAppInboundJob } from "../src/lib/queue/whatsappInboundQueue";
import type { WhatsAppClient } from "../src/lib/whatsapp/client";
import { handleInboundMessage } from "../src/worker/handlers/answerMessage";

let container: StartedPostgreSqlContainer;
let db: Db;
let tenantId: string;
let whatsappAccountId: string;

function buildJob(
  messageId: string,
  body: string,
  overrides?: Partial<WhatsAppInboundJob["message"]>,
) {
  return {
    tenantId,
    whatsappAccountId,
    phoneNumberId: "samyati-dev-phone-number-id",
    message: {
      id: messageId,
      from: "919876543210",
      timestamp: "1700000000",
      type: "text",
      text: { body },
      ...overrides,
    },
  } satisfies WhatsAppInboundJob;
}

function stubClient(sentTexts: string[]): WhatsAppClient {
  let counter = 0;
  return {
    sendTextMessage: async (_to, body) => {
      sentTexts.push(body);
      counter += 1;
      return { ok: true, metaMessageId: `wamid.reply-${counter}` };
    },
  };
}

async function getConversation() {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.tenantId, tenantId), eq(conversations.travellerPhone, "919876543210")),
    );
  return conversation;
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
    `truncate table "tenants", "whatsapp_accounts", "packages", "batches", "conversations", "messages", "escalations", "payment_installments", "cancellation_rules" restart identity cascade`,
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

describe("handleInboundMessage (intent router)", () => {
  it("answers a price question for a package mentioned by name, from the tool layer", async () => {
    const sent: string[] = [];
    await handleInboundMessage(
      { db, createClient: () => stubClient(sent) },
      buildJob("msg-1", "What is the price for the Kedarnath trip?"),
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Kedarnath-Badrinath Yatra");
    expect(sent[0]).toContain("Rs 21,111");

    const conversation = await getConversation();
    expect(conversation.status).toBe("open");
    expect(conversation.packageId).not.toBeNull();

    const escalationRows = await db
      .select()
      .from(escalations)
      .where(eq(escalations.tenantId, tenantId));
    expect(escalationRows).toHaveLength(0);
  });

  it("reports a sold-out batch as full and still surfaces the next available one", async () => {
    const [pkg] = await db
      .select()
      .from(packages)
      .where(and(eq(packages.tenantId, tenantId), eq(packages.slug, "kedarnath-badrinath-yatra")));

    // Make the seeded batch sold out, then add a later open one.
    await db.update(batches).set({ seatsAvailable: 0 }).where(eq(batches.packageId, pkg.id));
    await db.insert(batches).values({
      tenantId,
      packageId: pkg.id,
      departureDate: "2026-11-01",
      seatsTotal: 30,
      seatsAvailable: 12,
      startingPricePaise: 22_222_00,
      lastBookingDate: "2026-10-15",
    });

    const sent: string[] = [];
    await handleInboundMessage(
      { db, createClient: () => stubClient(sent) },
      buildJob("msg-batches", "Are there any upcoming batches for Kedarnath?"),
    );

    expect(sent[0]).toContain("Sold out");
    expect(sent[0]).toContain("12 seats available");
  });

  it("escalates a fitness or health question without generating any answer", async () => {
    const sent: string[] = [];
    await handleInboundMessage(
      { db, createClient: () => stubClient(sent) },
      buildJob("msg-health", "My knee is weak, is the Sikkim trip safe for me?"),
    );

    expect(sent).toHaveLength(1);
    // Only the generic holding reply, never a generated fitness assessment.
    expect(sent[0]).not.toMatch(/safe|knee|fitness/i);

    const conversation = await getConversation();
    expect(conversation.status).toBe("escalated");

    const [escalation] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.tenantId, tenantId));
    expect(escalation.reason).toBe("fitness_or_health");
  });

  it("escalates real booking intent instead of taking the booking", async () => {
    const sent: string[] = [];
    await handleInboundMessage(
      { db, createClient: () => stubClient(sent) },
      buildJob("msg-book", "I want to book this trip now, please confirm my seat"),
    );

    expect(sent[0]).toMatch(/team/i);

    const [escalation] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.tenantId, tenantId));
    expect(escalation.reason).toBe("booking_or_payment");
  });

  it("answers the how-to-book FAQ without escalating", async () => {
    const sent: string[] = [];
    await handleInboundMessage(
      { db, createClient: () => stubClient(sent) },
      buildJob("msg-howtobook", "How to book this package?"),
    );

    expect(sent[0]).toMatch(/installment/i);

    const conversation = await getConversation();
    expect(conversation.status).toBe("open");
  });

  it("asks a clarifying question when no package is mentioned or anchored, then escalates on the third", async () => {
    const sent: string[] = [];

    await handleInboundMessage(
      { db, createClient: () => stubClient(sent) },
      buildJob("msg-clarify-1", "What's the price?"),
    );
    expect(sent[0]).toMatch(/which package/i);
    let conversation = await getConversation();
    expect(conversation.pendingClarificationCount).toBe(1);
    expect(conversation.status).toBe("open");

    await handleInboundMessage(
      { db, createClient: () => stubClient(sent) },
      buildJob("msg-clarify-2", "How much does it cost?"),
    );
    conversation = await getConversation();
    expect(conversation.pendingClarificationCount).toBe(2);
    expect(conversation.status).toBe("open");

    await handleInboundMessage(
      { db, createClient: () => stubClient(sent) },
      buildJob("msg-clarify-3", "just tell me the cost"),
    );
    conversation = await getConversation();
    expect(conversation.status).toBe("escalated");

    const [escalation] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.tenantId, tenantId));
    expect(escalation.reason).toBe("clarification_limit_reached");
  });

  it("logs and escalates an unclassified message rather than staying silent", async () => {
    const sent: string[] = [];
    await handleInboundMessage(
      { db, createClient: () => stubClient(sent) },
      buildJob("msg-random", "asdkjashdkjashd"),
    );

    expect(sent).toHaveLength(1);
    const [escalation] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.tenantId, tenantId));
    expect(escalation.reason).toBe("unclassified_message");
  });

  it("stops auto-replying once a conversation is already escalated", async () => {
    const sent: string[] = [];
    await handleInboundMessage(
      { db, createClient: () => stubClient(sent) },
      buildJob("msg-escalate-first", "I want to book this trip now"),
    );
    expect(sent).toHaveLength(1);

    await handleInboundMessage(
      { db, createClient: () => stubClient(sent) },
      buildJob("msg-escalate-second", "hello are you there"),
    );

    // No second outbound message and no second escalation row.
    expect(sent).toHaveLength(1);
    const escalationRows = await db
      .select()
      .from(escalations)
      .where(eq(escalations.tenantId, tenantId));
    expect(escalationRows).toHaveLength(1);

    const conversationMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, (await getConversation()).id));
    const outbound = conversationMessages.filter((m) => m.direction === "outbound");
    expect(outbound).toHaveLength(1);
  });

  it("reuses the package anchor across messages in the same conversation", async () => {
    const sent: string[] = [];
    await handleInboundMessage(
      { db, createClient: () => stubClient(sent) },
      buildJob("msg-anchor-1", "What is the price for Gokarna?"),
    );
    await handleInboundMessage(
      { db, createClient: () => stubClient(sent) },
      buildJob("msg-anchor-2", "What are the inclusions?"),
    );

    expect(sent[1]).toContain("Gokarna-Murudeshwar");
  });

  it("throws when the WhatsApp send fails, leaving the inbound message persisted", async () => {
    const job = buildJob("msg-fail", "What is the price?");

    await expect(
      handleInboundMessage(
        {
          db,
          createClient: () => ({
            sendTextMessage: async () => ({ ok: false, error: "whatsapp send failed: 500" }),
          }),
        },
        job,
      ),
    ).rejects.toThrow("whatsapp send failed");

    const conversation = await getConversation();
    const conversationMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id));

    expect(conversationMessages).toHaveLength(1);
    expect(conversationMessages[0]?.direction).toBe("inbound");
  });
});
