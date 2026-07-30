import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MessageUnderstanding } from "../src/lib/core/understanding";
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
import type { AnswerGenerator } from "../src/lib/llm/answerModel";
import type { UnderstandingClassifier, UnderstandingInput } from "../src/lib/llm/understanding";
import type { WhatsAppInboundJob } from "../src/lib/queue/whatsappInboundQueue";
import type { Embedder } from "../src/lib/rag/embedder";
import { ingestKnowledgeSource } from "../src/lib/rag/ingest";
import type { WhatsAppClient } from "../src/lib/whatsapp/client";
import { handleInboundMessage } from "../src/worker/handlers/answerMessage";

// Must match EMBEDDING_DIMENSIONS in src/lib/db/schema.ts so the fake
// embedder produces vectors that pgvector accepts.
import { EMBEDDING_DIMENSIONS } from "../src/lib/db/schema";

// Same deterministic stand-in used in the retrieval integration test: no
// network call, but shared-vocabulary text still scores meaningfully higher,
// which is enough to exercise the retrieval gate without a live OpenAI key.
const fakeEmbedder: Embedder = async (texts) =>
  texts.map((text) => {
    const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
    for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = (hash * 31 + word.charCodeAt(i)) >>> 0;
      }
      vector[hash % EMBEDDING_DIMENSIONS] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  });

// Default: fails loudly if a test relies on real LLM generation without
// supplying its own stub.
const unusedAnswerGenerator: AnswerGenerator = async () => {
  throw new Error("answerGenerator should not have been called for this test");
};

// Stands in for the LLM understanding pass. Deterministic keyword rules are
// enough to drive the router in tests; the point under test is what the
// router does with an understanding, not how the model produced it.
function stubClassifier(
  rules: (input: UnderstandingInput) => Partial<MessageUnderstanding>,
): UnderstandingClassifier {
  return async (input) => ({
    understanding: {
      intent: "other",
      secondaryIntent: null,
      packageId: input.anchoredPackageId,
      packageCandidateIds: [],
      namedUnrecognizedPlace: false,
      safetyFlags: {
        fitnessOrHealth: false,
        bookingOrPayment: false,
        complaintOrSafety: false,
        humanRequest: false,
      },
      needsHuman: false,
      confidence: 0.9,
      ...rules(input),
    },
    usage: { model: "stub", inputTokens: 1, outputTokens: 1 },
  });
}

// Generic words that appear in package names ("Kerala Trip") but say nothing
// about which package a traveller means. Without this the stub resolves any
// message containing "trip" to whichever package happens to be listed first.
const STUB_NAME_STOPWORDS = new Set(["trip", "tour", "yatra", "special"]);

// Resolves a package by simple name matching over the real catalogue passed
// in, mimicking what the model does without the network call.
const catalogueClassifier: UnderstandingClassifier = stubClassifier((input) => {
  const text = input.message.toLowerCase();
  const hit = input.catalogue.find((entry) =>
    entry.name
      .toLowerCase()
      .split(/[\s-]+/)
      .some((word) => word.length >= 4 && !STUB_NAME_STOPWORDS.has(word) && text.includes(word)),
  );
  const intent: MessageUnderstanding["intent"] =
    text.includes("price") || text.includes("cost") || text.includes("how much")
      ? "price"
      : text.includes("batch") || text.includes("date")
        ? "batches"
        : text.includes("inclusion")
          ? "inclusions_exclusions"
          : text.includes("how to book")
            ? "how_to_book"
            : /^(hi|hello|hey)\b/.test(text)
              ? "greeting"
              : "general_knowledge";
  return { intent, packageId: hit?.id ?? input.anchoredPackageId ?? null };
});

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
      { db, createClient: () => stubClient(sent), understandingClassifier: catalogueClassifier },
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

  it("answers a transport-mode question with the anchored package's travel detail", async () => {
    const sent: string[] = [];
    // Resolves Nainital-Mussoorie from text or anchor, classifies anything
    // mentioning "train name" / "train" as departure_point. Mimics what the
    // real classifier+keyword router now does after the fix.
    const anchorClassifier: UnderstandingClassifier = stubClassifier((input) => {
      const text = input.message.toLowerCase();
      const hit = input.catalogue.find((entry) =>
        entry.name
          .toLowerCase()
          .split(/[\s-]+/)
          .some(
            (word) => word.length >= 4 && !STUB_NAME_STOPWORDS.has(word) && text.includes(word),
          ),
      );
      const intent: MessageUnderstanding["intent"] =
        text.includes("train name") || text.includes("which train")
          ? "departure_point"
          : text.includes("itinerary") || text.includes("day wise")
            ? "itinerary"
            : "package_overview";
      return { intent, packageId: hit?.id ?? input.anchoredPackageId ?? null };
    });

    await handleInboundMessage(
      { db, createClient: () => stubClient(sent), understandingClassifier: anchorClassifier },
      buildJob("msg-anchor-1", "Nainital?"),
    );
    expect(sent[0]).toContain("Nainital-Mussoorie");

    await handleInboundMessage(
      { db, createClient: () => stubClient(sent), understandingClassifier: anchorClassifier },
      buildJob("msg-train-name", "What is the train name?"),
    );

    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("Nainital-Mussoorie");
    expect(sent[1]).toContain("Bandra Haridwar Express");
  });

  it("returns the anchored package's itinerary when the traveller names an itinerary stop", async () => {
    const sent: string[] = [];
    // First message anchors Gokarna-Murudeshwar; second names an itinerary
    // stop with intent "other" — exactly the path that fell through to a
    // generic handoff in the live test.
    const otherIntentClassifier: UnderstandingClassifier = stubClassifier((input) => {
      const text = input.message.toLowerCase();
      const hit = input.catalogue.find((entry) =>
        entry.name
          .toLowerCase()
          .split(/[\s-]+/)
          .some(
            (word) => word.length >= 4 && !STUB_NAME_STOPWORDS.has(word) && text.includes(word),
          ),
      );
      return { intent: "other", packageId: hit?.id ?? input.anchoredPackageId ?? null };
    });

    await handleInboundMessage(
      {
        db,
        createClient: () => stubClient(sent),
        understandingClassifier: otherIntentClassifier,
      },
      buildJob("msg-gokarna-anchor", "Gokarna?"),
    );
    expect(sent[0]).toContain("Gokarna-Murudeshwar");

    await handleInboundMessage(
      {
        db,
        createClient: () => stubClient(sent),
        understandingClassifier: otherIntentClassifier,
      },
      buildJob("msg-apsarkonda", "Apsarkonda Waterfall?"),
    );

    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("Gokarna");
    expect(sent[1]).toMatch(/Apsarkonda|Day/i);
  });

  it("returns an off-catalogue reply for a destination we don't run", async () => {
    const sent: string[] = [];
    const offCatalogueClassifier: UnderstandingClassifier = stubClassifier(() => ({
      intent: "package_overview",
      namedUnrecognizedPlace: true,
    }));
    await handleInboundMessage(
      {
        db,
        createClient: () => stubClient(sent),
        understandingClassifier: offCatalogueClassifier,
      },
      buildJob("msg-dubai", "Dubai?"),
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/don't currently run/i);
    // Should still surface what we do have, like the catalogue listing does.
    expect(sent[0]).toMatch(/Kedarnath|Gokarna|Rameshwaram|Nainital|Sikkim|Kerala/);

    // Off-catalogue replies must not burn a clarification slot.
    const conversation = await getConversation();
    expect(conversation.pendingClarificationCount).toBe(0);
  });

  it("returns the anchored package overview on a second package-name follow up", async () => {
    const sent: string[] = [];
    // Stub that always classifies "Nainital?" as package_overview, regardless
    // of anchor — this is the failure mode the live test exposed.
    const browseClassifier: UnderstandingClassifier = stubClassifier((input) => {
      const text = input.message.toLowerCase();
      const hit = input.catalogue.find((entry) =>
        entry.name
          .toLowerCase()
          .split(/[\s-]+/)
          .some(
            (word) => word.length >= 4 && !STUB_NAME_STOPWORDS.has(word) && text.includes(word),
          ),
      );
      // Force browse_packages to mimic the model's misclassification.
      return { intent: "browse_packages", packageId: hit?.id ?? input.anchoredPackageId ?? null };
    });

    await handleInboundMessage(
      { db, createClient: () => stubClient(sent), understandingClassifier: browseClassifier },
      buildJob("msg-nainital-1", "Nainital?"),
    );
    expect(sent[0]).toContain("Nainital-Mussoorie");
    const lengthAfterFirst = sent[0].length;

    await handleInboundMessage(
      { db, createClient: () => stubClient(sent), understandingClassifier: browseClassifier },
      buildJob("msg-nainital-2", "Nainital?"),
    );

    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("Nainital-Mussoorie");
    // Overview reply shape: starts with "{name} is a {days} day, ..."
    expect(sent[1]).toMatch(/is a \d+ day, \d+ night trip/);
    // Catalogue listing is a much longer bullet list — overview is shorter.
    expect(sent[1].length).toBeLessThan(lengthAfterFirst * 5);
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
      { db, createClient: () => stubClient(sent), understandingClassifier: catalogueClassifier },
      buildJob("msg-batches", "Are there any upcoming batches for Kedarnath?"),
    );

    expect(sent[0]).toContain("Sold out");
    expect(sent[0]).toContain("12 seats available");
  });

  it("escalates a fitness or health question without generating any answer", async () => {
    const sent: string[] = [];
    await handleInboundMessage(
      { db, createClient: () => stubClient(sent), understandingClassifier: catalogueClassifier },
      buildJob("msg-health", "My knee is weak, is the Sikkim trip safe for me?"),
    );

    expect(sent).toHaveLength(1);
    // Only the generic holding reply, never a generated fitness assessment.
    expect(sent[0]).not.toMatch(/safe|knee|fitness/i);

    const conversation = await getConversation();
    expect(conversation.status).toBe("awaiting_human");

    const [escalation] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.tenantId, tenantId));
    expect(escalation.reason).toBe("fitness_or_health");
  });

  it("escalates real booking intent instead of taking the booking", async () => {
    const sent: string[] = [];
    await handleInboundMessage(
      { db, createClient: () => stubClient(sent), understandingClassifier: catalogueClassifier },
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
      { db, createClient: () => stubClient(sent), understandingClassifier: catalogueClassifier },
      buildJob("msg-howtobook", "How to book this package?"),
    );

    expect(sent[0]).toMatch(/installment/i);

    const conversation = await getConversation();
    expect(conversation.status).toBe("open");
  });

  it("asks a clarifying question when no package is mentioned or anchored, then escalates on the third", async () => {
    const sent: string[] = [];

    await handleInboundMessage(
      { db, createClient: () => stubClient(sent), understandingClassifier: catalogueClassifier },
      buildJob("msg-clarify-1", "What's the price?"),
    );
    expect(sent[0]).toMatch(/which package/i);
    let conversation = await getConversation();
    expect(conversation.pendingClarificationCount).toBe(1);
    expect(conversation.status).toBe("open");

    await handleInboundMessage(
      { db, createClient: () => stubClient(sent), understandingClassifier: catalogueClassifier },
      buildJob("msg-clarify-2", "How much does it cost?"),
    );
    conversation = await getConversation();
    expect(conversation.pendingClarificationCount).toBe(2);
    expect(conversation.status).toBe("open");

    await handleInboundMessage(
      { db, createClient: () => stubClient(sent), understandingClassifier: catalogueClassifier },
      buildJob("msg-clarify-3", "just tell me the cost"),
    );
    conversation = await getConversation();

    const [escalation] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.tenantId, tenantId));
    expect(escalation.reason).toBe("clarification_limit_reached");
  });

  it("escalates an unclassified message with no matching knowledge rather than staying silent", async () => {
    const sent: string[] = [];
    await handleInboundMessage(
      {
        db,
        createClient: () => stubClient(sent),
        embedder: fakeEmbedder,
        answerGenerator: unusedAnswerGenerator,
        understandingClassifier: catalogueClassifier,
      },
      buildJob("msg-random", "asdkjashdkjashd"),
    );

    expect(sent).toHaveLength(1);
    const [escalation] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.tenantId, tenantId));
    // No knowledge chunks are ingested in this test's tenant, so the
    // retrieval gate fails before the LLM is ever called.
    expect(escalation.reason).toBe("retrieval_low_confidence");
  });

  it("answers an unclassified question from retrieved knowledge, with sources recorded", async () => {
    const [pkg] = await db
      .select()
      .from(packages)
      .where(and(eq(packages.tenantId, tenantId), eq(packages.slug, "sikkim-darjeeling")));

    const { chunksInserted } = await ingestKnowledgeSource(db, tenantId, fakeEmbedder, {
      packageId: pkg.id,
      source: "permits_and_connectivity",
      content:
        "An Inner Line Permit is required for Nathula Pass and Tsomgo Lake since Nathula sits on the India-China border. The tour arranges this permit for travellers.",
    });
    expect(chunksInserted).toBeGreaterThan(0);

    const { rows: chunkRows } = await db.execute<{ id: string }>(sql`
      select id from knowledge_chunks
      where tenant_id = ${tenantId} and source = 'permits_and_connectivity'
    `);
    const [chunk] = chunkRows;

    const stubAnswerGenerator: AnswerGenerator = async ({ chunks }) => ({
      answer: {
        needsHuman: false,
        answerText:
          "Yes, an Inner Line Permit is required for Nathula Pass, and our team arranges it for you.",
        sourceIds: chunks.map((c) => c.id),
      },
      usage: { model: "stub", inputTokens: 1, outputTokens: 1 },
    });

    const sent: string[] = [];
    await handleInboundMessage(
      {
        db,
        createClient: () => stubClient(sent),
        embedder: fakeEmbedder,
        answerGenerator: stubAnswerGenerator,
        understandingClassifier: catalogueClassifier,
      },
      buildJob(
        "msg-permit",
        "Do I need an Inner Line Permit for Nathula Pass on the Sikkim Darjeeling trip?",
      ),
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/Inner Line Permit/i);

    const escalationRows = await db
      .select()
      .from(escalations)
      .where(eq(escalations.tenantId, tenantId));
    expect(escalationRows).toHaveLength(0);

    const [outbound] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, (await getConversation()).id),
          eq(messages.direction, "outbound"),
        ),
      );
    expect(outbound.sourceChunkIds).toEqual([chunk.id]);
  });

  it("discards and escalates when the model cites a source that was never retrieved", async () => {
    const [pkg] = await db
      .select()
      .from(packages)
      .where(and(eq(packages.tenantId, tenantId), eq(packages.slug, "sikkim-darjeeling")));

    await ingestKnowledgeSource(db, tenantId, fakeEmbedder, {
      packageId: pkg.id,
      source: "permits_and_connectivity",
      content:
        "An Inner Line Permit is required for Nathula Pass and Tsomgo Lake since Nathula sits on the India-China border.",
    });

    const hallucinatingAnswerGenerator: AnswerGenerator = async () => ({
      answer: {
        needsHuman: false,
        answerText: "Here is an answer citing a source that was never retrieved.",
        sourceIds: ["00000000-0000-0000-0000-000000000000"],
      },
      usage: { model: "stub", inputTokens: 1, outputTokens: 1 },
    });

    const sent: string[] = [];
    await handleInboundMessage(
      {
        db,
        createClient: () => stubClient(sent),
        embedder: fakeEmbedder,
        answerGenerator: hallucinatingAnswerGenerator,
        understandingClassifier: catalogueClassifier,
      },
      buildJob(
        "msg-hallucinate",
        "Do I need an Inner Line Permit for Nathula Pass on the Sikkim Darjeeling trip?",
      ),
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toMatch(/never retrieved/i);

    const [escalation] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.tenantId, tenantId));
    expect(escalation.reason).toBe("citation_invalid");
  });

  it("keeps answering factual questions while a handoff is pending, and flags the handoff", async () => {
    const sent: string[] = [];
    await handleInboundMessage(
      { db, createClient: () => stubClient(sent), understandingClassifier: catalogueClassifier },
      buildJob("msg-escalate-first", "I want to book this trip now"),
    );
    expect(sent).toHaveLength(1);
    expect((await getConversation()).status).toBe("awaiting_human");

    await handleInboundMessage(
      { db, createClient: () => stubClient(sent), understandingClassifier: catalogueClassifier },
      buildJob("msg-after-escalation", "What is the price for the Kedarnath trip?"),
    );

    // The traveller is not stranded behind the handoff: the factual question
    // is still answered plainly from the tool layer. No reminder suffix -
    // that only belongs on the escalating reply itself, not on every answer
    // that follows it.
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("Rs 21,111");
    expect(sent[1]).not.toMatch(/team is also looking into/i);
  });

  it("goes silent only once a human is actually active in the thread", async () => {
    const sent: string[] = [];
    await handleInboundMessage(
      { db, createClient: () => stubClient(sent), understandingClassifier: catalogueClassifier },
      buildJob("msg-human-1", "What is the price for the Kedarnath trip?"),
    );
    expect(sent).toHaveLength(1);

    await db
      .update(conversations)
      .set({ status: "human_active" })
      .where(eq(conversations.id, (await getConversation()).id));

    await handleInboundMessage(
      { db, createClient: () => stubClient(sent), understandingClassifier: catalogueClassifier },
      buildJob("msg-human-2", "What is the price for the Kedarnath trip?"),
    );

    expect(sent).toHaveLength(1);
  });

  it("leaves the conversation open after a soft escalation so the next message is handled normally", async () => {
    const sent: string[] = [];
    const throwingClassifier: UnderstandingClassifier = async () => {
      throw new Error("provider unavailable");
    };

    // Classifier down and nothing ingested: the knowledge path escalates
    // softly. That is the system's failure, not a reason to queue the
    // traveller behind a human.
    await handleInboundMessage(
      {
        db,
        createClient: () => stubClient(sent),
        embedder: fakeEmbedder,
        answerGenerator: unusedAnswerGenerator,
        understandingClassifier: throwingClassifier,
      },
      buildJob("msg-soft", "tell me something obscure about this"),
    );

    const conversation = await getConversation();
    expect(conversation.status).toBe("open");

    const [escalation] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.tenantId, tenantId));
    expect(escalation.severity).toBe("soft");

    // Next message is served normally rather than swallowed.
    await handleInboundMessage(
      { db, createClient: () => stubClient(sent), understandingClassifier: catalogueClassifier },
      buildJob("msg-soft-follow", "What is the price for the Kedarnath trip?"),
    );
    expect(sent[sent.length - 1]).toContain("Rs 21,111");
  });

  it("escalates on a model safety flag even when no keyword matches", async () => {
    const sent: string[] = [];
    const flaggingClassifier = stubClassifier(() => ({
      intent: "general_knowledge",
      safetyFlags: {
        fitnessOrHealth: true,
        bookingOrPayment: false,
        complaintOrSafety: false,
        humanRequest: false,
      },
    }));

    await handleInboundMessage(
      {
        db,
        createClient: () => stubClient(sent),
        embedder: fakeEmbedder,
        answerGenerator: unusedAnswerGenerator,
        understandingClassifier: flaggingClassifier,
      },
      // Phrased to dodge the keyword list entirely.
      buildJob("msg-flag", "my dad is 74, will he manage the climb up there?"),
    );

    const [escalation] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.tenantId, tenantId));
    expect(escalation.reason).toBe("fitness_or_health");
    expect(escalation.severity).toBe("hard");
  });

  it("still escalates on a keyword even when the model reports the message as safe", async () => {
    const sent: string[] = [];
    // Model insists everything is fine; the deterministic pre-gate must win.
    const permissiveClassifier = stubClassifier(() => ({
      intent: "price",
      needsHuman: false,
    }));

    await handleInboundMessage(
      {
        db,
        createClient: () => stubClient(sent),
        embedder: fakeEmbedder,
        answerGenerator: unusedAnswerGenerator,
        understandingClassifier: permissiveClassifier,
      },
      buildJob("msg-keyword-wins", "my knee is weak, is this trip ok for me"),
    );

    const [escalation] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.tenantId, tenantId));
    expect(escalation.reason).toBe("fitness_or_health");
    expect(sent[0]).not.toMatch(/knee/i);
    expect(sent[0]).not.toMatch(/Rs \d/);
  });

  it("discards a package id the model invented rather than quoting the wrong trip", async () => {
    const sent: string[] = [];
    const hallucinatingClassifier = stubClassifier(() => ({
      intent: "price",
      packageId: "00000000-0000-0000-0000-000000000000",
    }));

    await handleInboundMessage(
      {
        db,
        createClient: () => stubClient(sent),
        embedder: fakeEmbedder,
        answerGenerator: unusedAnswerGenerator,
        understandingClassifier: hallucinatingClassifier,
      },
      buildJob("msg-bad-id", "how much is it"),
    );

    // No anchor survives validation, so it asks which trip instead of
    // pricing an arbitrary one.
    expect(sent[0]).toMatch(/which package/i);
  });

  it("falls back to the keyword router when the classifier is unavailable", async () => {
    const sent: string[] = [];
    const throwingClassifier: UnderstandingClassifier = async () => {
      throw new Error("provider unavailable");
    };

    await handleInboundMessage(
      {
        db,
        createClient: () => stubClient(sent),
        embedder: fakeEmbedder,
        answerGenerator: unusedAnswerGenerator,
        understandingClassifier: throwingClassifier,
      },
      buildJob("msg-fallback", "What is the price for the Kedarnath trip?"),
    );

    // Degraded, but still a real tool-served answer rather than a holding reply.
    expect(sent[0]).toContain("Rs 21,111");
  });

  it("reuses the package anchor across messages in the same conversation", async () => {
    const sent: string[] = [];
    await handleInboundMessage(
      { db, createClient: () => stubClient(sent), understandingClassifier: catalogueClassifier },
      buildJob("msg-anchor-1", "What is the price for Gokarna?"),
    );
    await handleInboundMessage(
      { db, createClient: () => stubClient(sent), understandingClassifier: catalogueClassifier },
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
