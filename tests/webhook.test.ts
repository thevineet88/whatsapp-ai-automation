import { createHmac } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { Queue } from "bullmq";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Db, createDb } from "../src/lib/db/client";
import { seedSamyati } from "../src/lib/db/seed";
import { WHATSAPP_INBOUND_QUEUE } from "../src/lib/queue/whatsappInboundQueue";
import { createBullMQConnection } from "../src/lib/redis/client";

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";
const WEBHOOK_URL = "http://localhost:3000/api/webhook/whatsapp";

let postgres: StartedPostgreSqlContainer;
let redis: StartedRedisContainer;
let db: Db;
let inspectQueue: Queue;

function sign(rawBody: string): string {
  return `sha256=${createHmac("sha256", APP_SECRET).update(rawBody).digest("hex")}`;
}

function buildPayload(phoneNumberId: string, messageId: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "entry-1",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId, display_phone_number: "919999999999" },
              messages: [
                {
                  id: messageId,
                  from: "919876543210",
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "Hello" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

beforeAll(async () => {
  postgres = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  redis = await new RedisContainer("redis:7-alpine").start();

  process.env.DATABASE_URL = postgres.getConnectionUri();
  process.env.REDIS_URL = redis.getConnectionUrl();
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;

  db = createDb(process.env.DATABASE_URL);
  await migrate(db, { migrationsFolder: "./drizzle" });

  inspectQueue = new Queue(WHATSAPP_INBOUND_QUEUE, {
    connection: createBullMQConnection(process.env.REDIS_URL),
  });
}, 180_000);

afterAll(async () => {
  await inspectQueue.close();
  await db.$pool.end();
  await postgres.stop();
  await redis.stop();
});

describe("POST /api/webhook/whatsapp", () => {
  let phoneNumberId: string;

  beforeEach(async () => {
    await inspectQueue.drain(true);
    await inspectQueue.clean(0, 0, "completed");

    await db.execute(
      `truncate table "tenants", "whatsapp_accounts", "packages", "batches" restart identity cascade`,
    );

    const tenant = await seedSamyati(db);
    phoneNumberId = `phone-${tenant.id}`;

    const { whatsappAccounts } = await import("../src/lib/db/schema");
    await db.insert(whatsappAccounts).values({
      tenantId: tenant.id,
      phoneNumberId,
      displayPhoneNumber: "919999999999",
    });
  });

  it("rejects a forged signature and enqueues nothing", async () => {
    const { POST } = await import("../src/app/api/webhook/whatsapp/route");
    const payload = buildPayload(phoneNumberId, "msg-forged-1");
    const rawBody = JSON.stringify(payload);

    const req = new NextRequest(WEBHOOK_URL, {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=deadbeef" },
      body: rawBody,
    });

    const res = await POST(req);
    expect(res.status).toBe(401);

    const counts = await inspectQueue.getJobCounts();
    expect(counts.waiting ?? 0).toBe(0);
    expect(counts.completed ?? 0).toBe(0);
  });

  it("processes a duplicate delivery only once", async () => {
    const { POST } = await import("../src/app/api/webhook/whatsapp/route");
    const payload = buildPayload(phoneNumberId, "msg-dup-1");
    const rawBody = JSON.stringify(payload);
    const signature = sign(rawBody);

    const makeRequest = () =>
      new NextRequest(WEBHOOK_URL, {
        method: "POST",
        headers: { "x-hub-signature-256": signature },
        body: rawBody,
      });

    const first = await POST(makeRequest());
    expect(first.status).toBe(200);

    const second = await POST(makeRequest());
    expect(second.status).toBe(200);

    const jobs = await inspectQueue.getJobs(["waiting", "active", "completed", "delayed"]);
    const matching = jobs.filter((job) => job.id === "msg-dup-1");
    expect(matching).toHaveLength(1);
  });
});

describe("GET /api/webhook/whatsapp", () => {
  it("echoes the challenge for a valid verify token", async () => {
    const { GET } = await import("../src/app/api/webhook/whatsapp/route");
    const url = `${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=challenge-123`;
    const res = await GET(new NextRequest(url));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("challenge-123");
  });

  it("rejects an invalid verify token", async () => {
    const { GET } = await import("../src/app/api/webhook/whatsapp/route");
    const url = `${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123`;
    const res = await GET(new NextRequest(url));

    expect(res.status).toBe(403);
  });
});
