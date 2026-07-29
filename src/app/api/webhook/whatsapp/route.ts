import { whatsappWebhookPayloadSchema } from "@/lib/core/webhook";
import type { Db } from "@/lib/db/client";
import { createDb } from "@/lib/db/client";
import { processedWebhooks, whatsappAccounts } from "@/lib/db/schema";
import {
  type WhatsappInboundQueue,
  createWhatsappInboundQueue,
} from "@/lib/queue/whatsappInboundQueue";
import { type RedisClient, createBullMQConnection, createRedis } from "@/lib/redis/client";
import { verifySignature } from "@/lib/whatsapp/signature";
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7;

type Context = {
  db: Db;
  dedupeRedis: RedisClient;
  queue: WhatsappInboundQueue;
};

let context: Context | null = null;

// Lazily built from process.env on first request so tests can point env vars
// at testcontainers before the module's handlers are ever invoked.
function getContext(): Context {
  if (context) return context;

  const databaseUrl = requireEnv("DATABASE_URL");
  const redisUrl = requireEnv("REDIS_URL");

  context = {
    db: createDb(databaseUrl),
    dedupeRedis: createRedis(redisUrl),
    queue: createWhatsappInboundQueue(createBullMQConnection(redisUrl)),
  };
  return context;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export async function closeContextForTests(): Promise<void> {
  if (!context) return;
  await context.queue.close();
  context.dedupeRedis.disconnect();
  await context.db.$pool.end();
  context = null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token && verifyToken && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const appSecret = requireEnv("WHATSAPP_APP_SECRET");

  const signatureHeader = req.headers.get("x-hub-signature-256");
  if (!verifySignature(rawBody, signatureHeader, appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return new NextResponse("OK", { status: 200 });
  }

  const parsed = whatsappWebhookPayloadSchema.safeParse(json);
  if (!parsed.success) {
    console.error("whatsapp webhook: payload failed validation", parsed.error.flatten());
    return new NextResponse("OK", { status: 200 });
  }

  const { db, dedupeRedis, queue } = getContext();

  try {
    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        const { phone_number_id: phoneNumberId } = change.value.metadata;
        const messages = change.value.messages ?? [];
        if (messages.length === 0) continue;

        const [account] = await db
          .select()
          .from(whatsappAccounts)
          .where(eq(whatsappAccounts.phoneNumberId, phoneNumberId))
          .limit(1);

        if (!account) {
          console.error("whatsapp webhook: no tenant for phone_number_id", { phoneNumberId });
          continue;
        }

        for (const message of messages) {
          // Two-layer dedupe. Redis is the fast path, but it is a cache: a
          // flush, an eviction or a failover would silently reopen the door
          // to double processing, and invariant 7 says duplicates must be
          // impossible, not unlikely. The unique index on
          // processed_webhooks.meta_message_id is the durable authority.
          const dedupeKey = `wa:dedupe:${message.id}`;
          const wasSet = await dedupeRedis.set(dedupeKey, "1", "EX", DEDUPE_TTL_SECONDS, "NX");
          if (wasSet !== "OK") {
            continue;
          }

          const claimed = await db
            .insert(processedWebhooks)
            .values({ tenantId: account.tenantId, metaMessageId: message.id })
            .onConflictDoNothing()
            .returning();

          if (claimed.length === 0) {
            continue;
          }

          await queue.add(
            "inbound-message",
            {
              tenantId: account.tenantId,
              whatsappAccountId: account.id,
              phoneNumberId,
              message,
            },
            { jobId: message.id },
          );
        }
      }
    }
  } catch (error) {
    console.error("whatsapp webhook: failed to process payload", error);
    return new NextResponse("Internal error", { status: 500 });
  }

  return new NextResponse("OK", { status: 200 });
}
