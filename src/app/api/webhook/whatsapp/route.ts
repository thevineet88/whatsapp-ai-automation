import { whatsappWebhookPayloadSchema } from "@/lib/core/webhook";
import { createDb } from "@/lib/db/client";
import { processedWebhooks, whatsappAccounts } from "@/lib/db/schema";
import { createWhatsappInboundQueue } from "@/lib/queue/whatsappInboundQueue";
import { createBullMQConnection, createRedis } from "@/lib/redis/client";
import { verifySignature } from "@/lib/whatsapp/signature";
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7;

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
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return new NextResponse("Misconfigured", { status: 500 });
  }

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

  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl || !redisUrl) {
    return new NextResponse("Misconfigured", { status: 500 });
  }

  const db = createDb(databaseUrl);
  const dedupeRedis = createRedis(redisUrl);
  const queue = createWhatsappInboundQueue(createBullMQConnection(redisUrl));

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
          const dedupeKey = `wa:dedupe:${message.id}`;
          const wasSet = await dedupeRedis.set(dedupeKey, "1", "EX", DEDUPE_TTL_SECONDS, "NX");
          if (wasSet !== "OK") continue;

          const claimed = await db
            .insert(processedWebhooks)
            .values({ tenantId: account.tenantId, metaMessageId: message.id })
            .onConflictDoNothing()
            .returning();

          if (claimed.length === 0) continue;

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
