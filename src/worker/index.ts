import "dotenv/config";
import { createDb } from "@/lib/db/client";
import { WHATSAPP_INBOUND_QUEUE, type WhatsAppInboundJob } from "@/lib/queue/whatsappInboundQueue";
import { createBullMQConnection } from "@/lib/redis/client";
import { Worker } from "bullmq";
import { handleInboundMessage } from "./handlers/answerMessage";

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
});

worker.on("failed", (job, error) => {
  console.error("whatsapp worker: job failed", { jobId: job?.id, error: error.message });
});

async function shutdown(): Promise<void> {
  console.log("whatsapp worker: shutting down");
  await worker.close();
  await db.$pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
