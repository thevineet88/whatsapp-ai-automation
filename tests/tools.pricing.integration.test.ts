import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIRST_INSTALLMENT_NON_REFUNDABLE_NOTE } from "../src/lib/core/pricing";
import type { Db } from "../src/lib/db/client";
import { createDb } from "../src/lib/db/client";
import { batchPriceVariants, batches, packages, tenants } from "../src/lib/db/schema";
import { seedSamyati } from "../src/lib/db/seed";
import { getPaymentSchedule, getPrice } from "../src/lib/tools/pricing";

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

async function gokarnaBatch() {
  const [pkg] = await db
    .select()
    .from(packages)
    .where(and(eq(packages.tenantId, tenant.id), eq(packages.slug, "gokarna-murudeshwar")))
    .limit(1);
  const [batch] = await db.select().from(batches).where(eq(batches.packageId, pkg.id)).limit(1);
  return batch;
}

describe("get_price", () => {
  it("returns the batch's starting price with no variants when none are configured", async () => {
    const batch = await gokarnaBatch();

    const price = await getPrice(db, tenant.id, { batchId: batch.id });

    expect(price).toEqual({
      batchId: batch.id,
      startingPricePaise: batch.startingPricePaise,
      variants: [],
    });
  });

  it("returns per-occupancy variants ordered by price when a package defines room-type options", async () => {
    const batch = await gokarnaBatch();

    await db.insert(batchPriceVariants).values([
      { tenantId: tenant.id, batchId: batch.id, occupancyType: "triple", pricePaise: 19_999_00 },
      { tenantId: tenant.id, batchId: batch.id, occupancyType: "double", pricePaise: 22_999_00 },
    ]);

    const price = await getPrice(db, tenant.id, { batchId: batch.id });

    expect(price?.variants).toEqual([
      { occupancyType: "triple", pricePaise: 19_999_00 },
      { occupancyType: "double", pricePaise: 22_999_00 },
    ]);
  });

  it("returns null for a batch that does not exist or belongs to another tenant", async () => {
    const [batch] = await db.select().from(batches).where(eq(batches.tenantId, tenant.id)).limit(1);

    const missing = await getPrice(db, tenant.id, {
      batchId: "00000000-0000-0000-0000-000000000000",
    });
    expect(missing).toBeNull();

    const wrongTenant = await getPrice(db, "00000000-0000-0000-0000-000000000000", {
      batchId: batch.id,
    });
    expect(wrongTenant).toBeNull();
  });
});

describe("get_payment_schedule", () => {
  it("returns the installment table and cancellation policy as stored, in sequence order", async () => {
    const [pkg] = await db
      .select()
      .from(packages)
      .where(and(eq(packages.tenantId, tenant.id), eq(packages.slug, "kerala")))
      .limit(1);

    const schedule = await getPaymentSchedule(db, tenant.id, { packageId: pkg.id });

    expect(schedule.installments).toEqual([
      {
        sequence: 1,
        label: "1st Installment (Non-Refundable)",
        amountPaise: 8_555_00,
        dueBy: "25 July 2026",
      },
      {
        sequence: 2,
        label: "2nd Installment",
        amountPaise: 7_000_00,
        dueBy: "20 Aug 2026",
      },
    ]);

    // Installments always sum to exactly the batch's starting price.
    const totalInstallmentPaise = schedule.installments.reduce((sum, i) => sum + i.amountPaise, 0);
    const [batch] = await db.select().from(batches).where(eq(batches.packageId, pkg.id)).limit(1);
    expect(totalInstallmentPaise).toBe(batch.startingPricePaise);

    expect(schedule.cancellationPolicy).toEqual([
      { sequence: 1, cutoff: "On/Before 05 Aug 2026", deduction: "50%" },
      { sequence: 2, cutoff: "On/Before 25 Aug 2026", deduction: "90%" },
      { sequence: 3, cutoff: "After that", deduction: "No Refund" },
    ]);

    expect(schedule.note).toBe(FIRST_INSTALLMENT_NON_REFUNDABLE_NOTE);
  });

  it("returns empty tables for a package with no configured schedule, never fabricating one", async () => {
    const [otherTenant] = await db
      .insert(tenants)
      .values({ name: "Other Operator", slug: `other-operator-${Date.now()}` })
      .returning();

    const schedule = await getPaymentSchedule(db, otherTenant.id, {
      packageId: "00000000-0000-0000-0000-000000000000",
    });

    expect(schedule.installments).toEqual([]);
    expect(schedule.cancellationPolicy).toEqual([]);
    expect(schedule.note).toBe(FIRST_INSTALLMENT_NON_REFUNDABLE_NOTE);
  });
});
