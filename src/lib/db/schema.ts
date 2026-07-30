import { packageCategoryValues } from "@/lib/core/package";
import { relations } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Embedding dimension for jina-embeddings-v2-base-en. Revisit if the
// embedding model changes; the vector column and its index must match this
// dimension. Migration required when this value changes.
export const EMBEDDING_DIMENSIONS = 768;

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${EMBEDDING_DIMENSIONS})`;
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    return value
      .slice(1, -1)
      .split(",")
      .map((n) => Number(n));
  },
});

export const packageCategoryEnum = pgEnum("package_category", packageCategoryValues);

export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);

// Three statuses. A `closed` state used to exist: it meant "the human has
// resolved this conversation", with the side effect that the bot would never
// reply to that traveller again. That is wrong on WhatsApp, which has no
// session boundary. A traveller who was resolved yesterday will message
// today about something unrelated, and they expect an answer, not silence.
// The new admin action is "Return to Bot" (human_active -> open), which
// gives the team a way to hand a thread back without stranding the traveller.
// `escalated` is retained only for rows written before that split.
export const conversationStatusEnum = pgEnum("conversation_status", [
  "open",
  "escalated",
  "awaiting_human",
  "human_active",
]);

// Conversation phases for multi-turn flows (custom package and booking
// collection). Null means no active collection. The phase is set when the
// router detects a collector intent, and cleared when the collection is
// escalated back to the team.
export const conversationPhaseEnum = pgEnum("conversation_phase", [
  "collecting_custom_package",
  "collecting_booking",
]);

// Hard escalations are the ones a human must own (health, booking, money,
// complaints, an explicit ask for a person). Soft ones are the system's own
// failures (a timeout, weak retrieval, an unparseable message): the team
// should see them, but they must not silence the bot or strand the
// traveller, which is what a single undifferentiated status used to do.
export const escalationSeverityEnum = pgEnum("escalation_severity", ["hard", "soft"]);

export const escalationStatusEnum = pgEnum("escalation_status", [
  "pending",
  "acknowledged",
  "resolved",
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const whatsappAccounts = pgTable(
  "whatsapp_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    phoneNumberId: text("phone_number_id").notNull(),
    displayPhoneNumber: text("display_phone_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("whatsapp_accounts_phone_number_id_idx").on(table.phoneNumberId),
    index("whatsapp_accounts_tenant_id_idx").on(table.tenantId),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    whatsappAccountId: uuid("whatsapp_account_id")
      .notNull()
      .references(() => whatsappAccounts.id),
    travellerPhone: text("traveller_phone").notNull(),
    packageId: uuid("package_id").references(() => packages.id),
    status: conversationStatusEnum("status").notNull().default("open"),
    // Set when the router is collecting information from the traveller for a
    // custom package or booking request. Null means the bot is in normal
    // question-answering mode.
    phase: conversationPhaseEnum("phase"),
    // Structured data collected during the current collection phase. Reset to
    // null when the phase ends. Schema varies by phase.
    collectorData: jsonb("collector_data").$type<Record<string, unknown>>(),
    pendingClarificationCount: integer("pending_clarification_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("conversations_tenant_id_idx").on(table.tenantId),
    index("conversations_traveller_phone_idx").on(table.tenantId, table.travellerPhone),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    metaMessageId: text("meta_message_id"),
    direction: messageDirectionEnum("direction").notNull(),
    content: text("content").notNull(),
    // Populated only for outbound replies generated by the LLM answer
    // pipeline: the knowledge_chunks ids the answer actually cited. Null for
    // inbound messages and for outbound replies served straight from the
    // tool layer or hardcoded text, which carry no chunk sources.
    sourceChunkIds: jsonb("source_chunk_ids").$type<string[]>(),
    // Set on an outbound reply that was a handoff or holding message rather
    // than a real answer. Two jobs: it is the durable trace of why the bot
    // said what it said, and it lets the understanding pass exclude the
    // bot's own boilerplate from conversation history. Feeding "our team
    // will get back to you" back to the model taught it that a human was
    // already handling the thread, which made it escalate the next message
    // too, and the next: a self-reinforcing loop that answered nothing.
    escalationReason: text("escalation_reason"),
    // Marks outbound replies typed by a human admin through the admin panel,
    // not generated by the bot. Lets the thread view show who said what.
    isAdminReply: boolean("is_admin_reply").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("messages_tenant_id_idx").on(table.tenantId),
    index("messages_conversation_id_idx").on(table.conversationId),
    // Invariant 7, enforced by the database rather than by convention: a
    // retried job must never be able to persist the same inbound message
    // twice. Postgres allows repeated NULLs, so rows without a Meta id (a
    // send that never got an id back) are unaffected.
    uniqueIndex("messages_meta_message_id_idx").on(table.metaMessageId),
  ],
);

export const packages = pgTable(
  "packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    category: packageCategoryEnum("category").array().notNull(),
    durationDays: integer("duration_days").notNull(),
    durationNights: integer("duration_nights").notNull(),
    highlights: jsonb("highlights").$type<string[]>().notNull(),
    advisory: text("advisory").notNull(),
    flightInformation: text("flight_information"),
    departurePoint: text("departure_point").notNull(),
    travelMode: text("travel_mode").notNull(),
    returnPoint: text("return_point").notNull(),
    itinerary: jsonb("itinerary")
      .$type<{ day: number; title: string; description: string; date?: string; meals?: string }[]>()
      .notNull(),
    inclusions: jsonb("inclusions").$type<string[]>().notNull(),
    exclusions: jsonb("exclusions").$type<string[]>().notNull(),
    pointsToNote: jsonb("points_to_note").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("packages_tenant_id_idx").on(table.tenantId),
    uniqueIndex("packages_tenant_id_slug_idx").on(table.tenantId, table.slug),
  ],
);

export const batches = pgTable(
  "batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id),
    departureDate: date("departure_date").notNull(),
    seatsTotal: integer("seats_total").notNull(),
    seatsAvailable: integer("seats_available").notNull(),
    startingPricePaise: integer("starting_price_paise").notNull(),
    // Nullable: some real batches don't have a fixed cutoff yet ("Contact
    // us" on the source site) and travellers should still see the batch.
    lastBookingDate: date("last_booking_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("batches_tenant_id_idx").on(table.tenantId),
    index("batches_package_id_idx").on(table.packageId),
  ],
);

export const paymentInstallments = pgTable(
  "payment_installments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id),
    sequence: integer("sequence").notNull(),
    label: text("label").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    dueBy: text("due_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("payment_installments_tenant_id_idx").on(table.tenantId),
    index("payment_installments_package_id_idx").on(table.packageId),
    uniqueIndex("payment_installments_package_sequence_idx").on(table.packageId, table.sequence),
  ],
);

export const cancellationRules = pgTable(
  "cancellation_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id),
    sequence: integer("sequence").notNull(),
    cutoff: text("cutoff").notNull(),
    deduction: text("deduction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("cancellation_rules_tenant_id_idx").on(table.tenantId),
    index("cancellation_rules_package_id_idx").on(table.packageId),
    uniqueIndex("cancellation_rules_package_sequence_idx").on(table.packageId, table.sequence),
  ],
);

export const batchPriceVariants = pgTable(
  "batch_price_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id),
    occupancyType: text("occupancy_type").notNull(),
    pricePaise: integer("price_paise").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("batch_price_variants_tenant_id_idx").on(table.tenantId),
    index("batch_price_variants_batch_id_idx").on(table.batchId),
    uniqueIndex("batch_price_variants_batch_occupancy_idx").on(table.batchId, table.occupancyType),
  ],
);

// Colloquial names travellers actually type that the package's own fields
// don't contain: a landmark dropped from the slug ("omkareshwar"), a circuit
// name ("char dham"), a nearby city, a regional term ("jyotirlinga"). Stored
// rather than hardcoded so the team can add one without a deploy, and read
// both by the deterministic matcher and the LLM understanding prompt.
export const packageAliases = pgTable(
  "package_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id),
    alias: text("alias").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("package_aliases_tenant_id_idx").on(table.tenantId),
    index("package_aliases_package_id_idx").on(table.packageId),
    uniqueIndex("package_aliases_package_alias_idx").on(table.packageId, table.alias),
  ],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    packageId: uuid("package_id").references(() => packages.id),
    content: text("content").notNull(),
    source: text("source").notNull(),
    embedding: vector("embedding").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("knowledge_chunks_tenant_id_idx").on(table.tenantId),
    index("knowledge_chunks_package_id_idx").on(table.packageId),
    index("knowledge_chunks_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

export const tenantConfigs = pgTable(
  "tenant_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    version: integer("version").notNull(),
    escalationContacts: jsonb("escalation_contacts")
      .$type<{ name: string; phone: string }[]>()
      .notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tenant_configs_tenant_id_idx").on(table.tenantId),
    uniqueIndex("tenant_configs_tenant_id_version_idx").on(table.tenantId, table.version),
  ],
);

export const escalations = pgTable(
  "escalations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    reason: text("reason").notNull(),
    severity: escalationSeverityEnum("severity").notNull().default("hard"),
    // Structured summary carried from the router to the admin view. Used by
    // the custom package and booking collectors to surface what the traveller
    // actually said before any handoff, so the team doesn't have to scroll
    // back through the whole thread.
    detail: text("detail"),
    status: escalationStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("escalations_tenant_id_idx").on(table.tenantId),
    index("escalations_conversation_id_idx").on(table.conversationId),
  ],
);

export const processedWebhooks = pgTable(
  "processed_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    metaMessageId: text("meta_message_id").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("processed_webhooks_meta_message_id_idx").on(table.metaMessageId)],
);

// The durable per-message trace required by the answer pipeline step 9:
// tool calls, retrieved chunks, prompt/config version, model, token counts,
// latency. Written from handleInboundMessage for every inbound message,
// regardless of whether the outbound send succeeds, so a bot mute doesn't
// erase the record. The Langfuse UI is the LLM-centric view; this table is
// the SQL-queryable view (by conversation, time range, escalation reason).
export const messageTraces = pgTable(
  "message_traces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id),
    intent: text("intent").notNull(),
    anchorPackageId: uuid("anchor_package_id").references(() => packages.id),
    // Array of {name, input, output} per tool the router invoked. Empty
    // when the message was a single LLM call or an escalation with no tool.
    toolCalls: jsonb("tool_calls")
      .$type<{ name: string; input: unknown; output: unknown }[]>()
      .notNull()
      .default([]),
    retrievedChunkIds: jsonb("retrieved_chunk_ids").$type<string[]>().notNull().default([]),
    // Pinned to the active tenant config version when the trace was written,
    // so a trace is reproducible by knowing what the system believed at that
    // point.
    promptVersion: text("prompt_version").notNull(),
    configVersion: integer("config_version").notNull(),
    llmModel: text("llm_model"),
    llmInputTokens: integer("llm_input_tokens"),
    llmOutputTokens: integer("llm_output_tokens"),
    retrievalTopScore: integer("retrieval_top_score"),
    latencyMs: integer("latency_ms").notNull(),
    // Terminal outcome of the routing pipeline for this message.
    result: text("result").notNull(),
    escalationReason: text("escalation_reason"),
    // Chunks the answer actually cited. Null for tool-served replies and for
    // escalations.
    sourceChunkIds: jsonb("source_chunk_ids").$type<string[] | null>(),
    // Opaque id handed back by Langfuse so this row links into the trace UI.
    langfuseTraceId: text("langfuse_trace_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("message_traces_tenant_id_idx").on(table.tenantId),
    index("message_traces_conversation_id_idx").on(table.conversationId),
    index("message_traces_message_id_idx").on(table.messageId),
    index("message_traces_result_idx").on(table.result),
    index("message_traces_created_at_idx").on(table.createdAt),
  ],
);

export const tenantsRelations = relations(tenants, ({ many }) => ({
  whatsappAccounts: many(whatsappAccounts),
  conversations: many(conversations),
  packages: many(packages),
}));

export const packagesRelations = relations(packages, ({ one, many }) => ({
  tenant: one(tenants, { fields: [packages.tenantId], references: [tenants.id] }),
  batches: many(batches),
  paymentInstallments: many(paymentInstallments),
  cancellationRules: many(cancellationRules),
  aliases: many(packageAliases),
}));

export const packageAliasesRelations = relations(packageAliases, ({ one }) => ({
  package: one(packages, { fields: [packageAliases.packageId], references: [packages.id] }),
}));

export const batchesRelations = relations(batches, ({ one, many }) => ({
  package: one(packages, { fields: [batches.packageId], references: [packages.id] }),
  priceVariants: many(batchPriceVariants),
}));

export const paymentInstallmentsRelations = relations(paymentInstallments, ({ one }) => ({
  package: one(packages, { fields: [paymentInstallments.packageId], references: [packages.id] }),
}));

export const cancellationRulesRelations = relations(cancellationRules, ({ one }) => ({
  package: one(packages, { fields: [cancellationRules.packageId], references: [packages.id] }),
}));

export const batchPriceVariantsRelations = relations(batchPriceVariants, ({ one }) => ({
  batch: one(batches, { fields: [batchPriceVariants.batchId], references: [batches.id] }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  tenant: one(tenants, { fields: [conversations.tenantId], references: [tenants.id] }),
  whatsappAccount: one(whatsappAccounts, {
    fields: [conversations.whatsappAccountId],
    references: [whatsappAccounts.id],
  }),
  package: one(packages, { fields: [conversations.packageId], references: [packages.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const messageTracesRelations = relations(messageTraces, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messageTraces.conversationId],
    references: [conversations.id],
  }),
  message: one(messages, {
    fields: [messageTraces.messageId],
    references: [messages.id],
  }),
}));
