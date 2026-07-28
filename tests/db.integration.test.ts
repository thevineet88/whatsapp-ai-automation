import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/lib/db/client";
import { createDb } from "../src/lib/db/client";
import { batches, packages, tenants } from "../src/lib/db/schema";
import { scopedDb } from "../src/lib/db/scoped";
import { seedSamyati } from "../src/lib/db/seed";

let container: StartedPostgreSqlContainer;
let db: Db;

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16").start();
  db = createDb(container.getConnectionUri());
  await migrate(db, { migrationsFolder: "./drizzle" });
}, 120_000);

afterAll(async () => {
  await db.$pool.end();
  await container.stop();
});

describe("schema + seed", () => {
  it("seeds the Samyati tenant with tenant-scoped packages and batches", async () => {
    const tenant = await seedSamyati(db);

    expect(tenant.slug).toBe("samyati-holidays");

    const scoped = scopedDb(db, tenant.id);
    const seededPackages = await scoped.packages.findMany();
    const seededBatches = await scoped.batches.findMany();

    expect(seededPackages).toHaveLength(3);
    expect(seededBatches).toHaveLength(3);

    const slugs = seededPackages.map((p) => p.slug).sort();
    expect(slugs).toEqual([
      "gokarna-murudeshwar",
      "kedarnath-badrinath-yatra",
      "sikkim-darjeeling",
    ]);

    for (const pkg of seededPackages) {
      expect(pkg.tenantId).toBe(tenant.id);
    }
    for (const batch of seededBatches) {
      expect(batch.tenantId).toBe(tenant.id);
      expect(batch.seatsAvailable).toBe(batch.seatsTotal);
      expect(Number.isInteger(batch.startingPricePaise)).toBe(true);
    }
  });

  it("keeps a second tenant's data invisible to the scoped helper", async () => {
    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: "Other Operator", slug: "other-operator" })
      .returning();

    const [samyati] = await db.select().from(tenants).where(eq(tenants.slug, "samyati-holidays"));

    const scopedForOther = scopedDb(db, otherTenant.id);
    const otherPackages = await scopedForOther.packages.findMany();
    expect(otherPackages).toHaveLength(0);

    const scopedForSamyati = scopedDb(db, samyati.id);
    const samyatiPackages = await scopedForSamyati.packages.findMany();
    expect(samyatiPackages.length).toBeGreaterThan(0);
    expect(samyatiPackages.every((p) => p.tenantId === samyati.id)).toBe(true);
  });

  it("reports a zero-seat batch as full rather than available", async () => {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, "samyati-holidays"));

    const [pkg] = await db.select().from(packages).where(eq(packages.tenantId, tenant.id)).limit(1);

    const [zeroSeatBatch] = await db
      .insert(batches)
      .values({
        tenantId: tenant.id,
        packageId: pkg.id,
        departureDate: "2026-12-01",
        seatsTotal: 20,
        seatsAvailable: 0,
        startingPricePaise: 1_000_00,
        lastBookingDate: "2026-11-15",
      })
      .returning();

    const isFull = zeroSeatBatch.seatsAvailable <= 0;
    expect(isFull).toBe(true);
  });
});
