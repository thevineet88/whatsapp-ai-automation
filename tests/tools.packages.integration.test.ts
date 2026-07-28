import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/lib/db/client";
import { createDb } from "../src/lib/db/client";
import { batches, packages } from "../src/lib/db/schema";
import { seedSamyati } from "../src/lib/db/seed";
import { checkSeats, listBatches, searchPackages } from "../src/lib/tools/packages";

let container: StartedPostgreSqlContainer;
let db: Db;
let tenant: Awaited<ReturnType<typeof seedSamyati>>;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  db = createDb(container.getConnectionUri());
  await migrate(db, { migrationsFolder: "./drizzle" });
  tenant = await seedSamyati(db);
}, 120_000);

afterAll(async () => {
  await db.$pool.end();
  await container.stop();
});

describe("search_packages", () => {
  it("filters by category", async () => {
    const results = await searchPackages(db, tenant.id, { category: "spiritual" });
    expect(results.map((p) => p.slug)).toEqual(["kedarnath-badrinath-yatra"]);
  });

  it("filters by region term matched against name and travel points", async () => {
    const results = await searchPackages(db, tenant.id, { region: "Gokarna" });
    expect(results.map((p) => p.slug)).toEqual(["gokarna-murudeshwar"]);
  });

  it("filters by exact duration in days", async () => {
    const results = await searchPackages(db, tenant.id, { durationDays: 5 });
    expect(results.map((p) => p.slug)).toEqual(["gokarna-murudeshwar"]);
  });

  it("filters by the month a package has an upcoming batch departing", async () => {
    const results = await searchPackages(db, tenant.id, { month: 9 });
    expect(results.map((p) => p.slug)).toEqual(["kedarnath-badrinath-yatra"]);
  });

  it("never returns another tenant's packages", async () => {
    const [otherPackage] = await db.select().from(packages).limit(1);
    const results = await searchPackages(db, "00000000-0000-0000-0000-000000000000");
    expect(results.find((p) => p.id === otherPackage.id)).toBeUndefined();
  });
});

describe("list_batches and check_seats", () => {
  it("reports a zero-seat batch as full and lets a caller skip to the next available one", async () => {
    const [pkg] = await db.select().from(packages).where(eqTenantAndSlug(tenant.id)).limit(1);

    const [soldOutBatch] = await db
      .insert(batches)
      .values({
        tenantId: tenant.id,
        packageId: pkg.id,
        departureDate: "2026-08-01",
        seatsTotal: 20,
        seatsAvailable: 0,
        startingPricePaise: 15_000_00,
        lastBookingDate: "2026-07-15",
      })
      .returning();

    const [openBatch] = await db
      .insert(batches)
      .values({
        tenantId: tenant.id,
        packageId: pkg.id,
        departureDate: "2026-09-01",
        seatsTotal: 20,
        seatsAvailable: 5,
        startingPricePaise: 15_500_00,
        lastBookingDate: "2026-08-15",
      })
      .returning();

    const upcoming = await listBatches(db, tenant.id, {
      packageId: pkg.id,
      fromDate: "2026-07-20",
    });

    expect(upcoming[0].id).toBe(soldOutBatch.id);
    expect(upcoming[0].isFull).toBe(true);

    const nextAvailable = upcoming.find((batch) => !batch.isFull);
    expect(nextAvailable?.id).toBe(openBatch.id);
    expect(nextAvailable?.id).not.toBe(soldOutBatch.id);

    const soldOutSeats = await checkSeats(db, tenant.id, { batchId: soldOutBatch.id });
    expect(soldOutSeats).toEqual({ batchId: soldOutBatch.id, seatsAvailable: 0, isFull: true });

    const openSeats = await checkSeats(db, tenant.id, { batchId: openBatch.id });
    expect(openSeats).toEqual({ batchId: openBatch.id, seatsAvailable: 5, isFull: false });
  });

  it("excludes batches before fromDate and returns null seats for an unknown batch", async () => {
    const [pkg] = await db.select().from(packages).where(eqTenantAndSlug(tenant.id)).limit(1);

    const upcoming = await listBatches(db, tenant.id, {
      packageId: pkg.id,
      fromDate: "2027-01-01",
    });
    expect(upcoming).toHaveLength(0);

    const missing = await checkSeats(db, tenant.id, {
      batchId: "00000000-0000-0000-0000-000000000000",
    });
    expect(missing).toBeNull();
  });
});

function eqTenantAndSlug(tenantId: string) {
  return and(eq(packages.tenantId, tenantId), eq(packages.slug, "kedarnath-badrinath-yatra"));
}
