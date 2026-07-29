import "dotenv/config";
import { createDb } from "@/lib/db/client";
import { whatsappAccounts } from "@/lib/db/schema";
import { WHATSAPP_INBOUND_QUEUE, type WhatsAppInboundJob } from "@/lib/queue/whatsappInboundQueue";
import { createBullMQConnection } from "@/lib/redis/client";
import { checkWhatsAppCredentials } from "@/lib/whatsapp/client";
import { Worker } from "bullmq";
import { handleInboundMessage } from "./handlers/answerMessage";
import { initSentry, flushSentry } from "@/lib/observability/sentry";

initSentry();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const databaseUrl = requireEnv("DATABASE_URL");
const redisUrl = requireEnv("REDIS_URL");

const db = createDb(databaseUrl);

const worker = new Worker<WhatsAppInboundJob>(
  WHATSAPP_INBOUND_QUEUE,
  async (job) => {
    await handleInboundMessage({ db }, job.data);
  },
  { connection: createBullMQConnection(redisUrl), concurrency: 5 },
);

worker.on("ready", () => {
  console.log("whatsapp worker: ready");
  void verifyWhatsAppCredentials();
});

worker.on("failed", (job, error) => {
  // attemptsMade vs the configured attempts tells the operator whether this
  // message is being retried or has been given up on, which is the
  // difference between a blip and a traveller who never got an answer.
  const attemptsMade = job?.attemptsMade ?? 0;
  const maxAttempts = job?.opts?.attempts ?? 1;
  const exhausted = attemptsMade >= maxAttempts;
  console.error("whatsapp worker: job failed", {
    jobId: job?.id,
    attemptsMade,
    maxAttempts,
    willRetry: !exhausted,
    error: error.message,
  });
  if (exhausted) {
    console.error("whatsapp worker: GIVING UP on message, traveller received no reply", {
      jobId: job?.id,
    });
  }
});

// Checked once at boot against every configured number. An expired or
// malformed token fails every send with the same opaque error, so it is
// worth one request at startup to say so plainly instead of letting it be
// discovered message by message.
async function verifyWhatsAppCredentials(): Promise<void> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    console.error("whatsapp worker: WHATSAPP_ACCESS_TOKEN is not set, every reply will fail");
    return;
  }

  const accounts = await db.select().from(whatsappAccounts);
  if (accounts.length === 0) {
    console.error("whatsapp worker: no whatsapp_accounts rows, inbound messages cannot be routed");
    return;
  }

  for (const account of accounts) {
    const result = await checkWhatsAppCredentials({
      accessToken,
      phoneNumberId: account.phoneNumberId,
    });
    if (result.ok) {
      console.log("whatsapp worker: credentials ok", { phoneNumberId: account.phoneNumberId });
    } else {
      console.error("whatsapp worker: CREDENTIALS INVALID, replies will fail until this is fixed", {
        phoneNumberId: account.phoneNumberId,
        error: result.error,
      });
    }
  }
}

async function shutdown(): Promise<void> {
  console.log("whatsapp worker: shutting down");
  await worker.close();
  await flushSentry();
  await db.$pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
