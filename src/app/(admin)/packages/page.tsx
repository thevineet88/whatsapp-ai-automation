import { packages, tenants } from "@/lib/db/schema";
import { getServerDb } from "@/lib/db/serverDb";
import { eq } from "drizzle-orm";
import Link from "next/link";

export default async function PackagesPage() {
  const db = getServerDb();
  const [tenant] = await db.select().from(tenants).limit(1);

  if (!tenant) {
    return <p>No tenant found. Run the seed script first.</p>;
  }

  const rows = await db.select().from(packages).where(eq(packages.tenantId, tenant.id));

  return (
    <main>
      <h1>Packages</h1>
      <p>
        <Link href="/packages/new">+ New package</Link>
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th style={{ padding: "0.4rem 0" }}>Name</th>
            <th>Category</th>
            <th>Duration</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((pkg) => (
            <tr key={pkg.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "0.4rem 0" }}>{pkg.name}</td>
              <td>{pkg.category}</td>
              <td>
                {pkg.durationDays}D/{pkg.durationNights}N
              </td>
              <td>
                <Link href={`/packages/${pkg.id}`}>Edit</Link>
                {" · "}
                <Link href={`/packages/${pkg.id}/batches`}>Batches</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p>No packages yet.</p> : null}
    </main>
  );
}
