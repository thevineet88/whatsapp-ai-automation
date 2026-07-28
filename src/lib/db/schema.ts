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

// Embedding dimension for text-embedding-3-small. Revisit if the embedding
// model changes; the vector column and its index must match this dimension.
const EMBEDDING_DIMENSIONS = 1536;

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

export const conversationStatusEnum = pgEnum("conversation_status", [
  "open",
  "escalated",
  "closed",
]);

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("messages_tenant_id_idx").on(table.tenantId),
    index("messages_conversation_id_idx").on(table.conversationId),
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
    category: packageCategoryEnum("category").notNull(),
    durationDays: integer("duration_days").notNull(),
    durationNights: integer("duration_nights").notNull(),
    highlights: jsonb("highlights").$type<string[]>().notNull(),
    advisory: text("advisory").notNull(),
    flightInformation: text("flight_information"),
    departurePoint: text("departure_point").notNull(),
    travelMode: text("travel_mode").notNull(),
    returnPoint: text("return_point").notNull(),
    itinerary: jsonb("itinerary")
      .$type<{ day: number; title: string; description: string }[]>()
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
    lastBookingDate: date("last_booking_date").notNull(),
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
