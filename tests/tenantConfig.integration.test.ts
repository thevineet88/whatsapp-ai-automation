import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/lib/db/client";
import { createDb } from "../src/lib/db/client";
import type { tenants } from "../src/lib/db/schema";
import { seedSamyati } from "../src/lib/db/seed";
import { createTenantConfigVersion, getActiveTenantConfig } from "../src/lib/db/tenantConfig";

let container: StartedPostgreSqlContainer;
let db: Db;
let tenant: typeof tenants.$inferSelect;

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

describe("tenant config versioning", () => {
  it("writes a new version and deactivates the previous one instead of overwriting", async () => {
    const initial = await getActiveTenantConfig(db, tenant.id);
    expect(initial?.version).toBe(1);
    expect(initial?.escalationContacts).toHaveLength(3);

    const updated = await createTenantConfigVersion(db, tenant.id, {
      escalationContacts: [{ name: "Rohit", phone: "+91 90760 68549" }],
    });

    expect(updated.version).toBe(2);
    expect(updated.isActive).toBe(true);

    const active = await getActiveTenantConfig(db, tenant.id);
    expect(active?.id).toBe(updated.id);
    expect(active?.escalationContacts).toEqual([{ name: "Rohit", phone: "+91 90760 68549" }]);
  });

  it("scopes the active config lookup to the given tenant", async () => {
    const active = await getActiveTenantConfig(db, tenant.id);
    expect(active?.escalationContacts.length).toBeGreaterThan(0);

    const noConfig = await getActiveTenantConfig(db, "00000000-0000-0000-0000-000000000000");
    expect(noConfig).toBeNull();
  });
});
