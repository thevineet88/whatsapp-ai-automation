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
    <>
      <div
        className="page-header"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}
      >
        <div>
          <h1 className="page-title">Packages</h1>
          <p className="page-subtitle">
            {rows.length} {rows.length === 1 ? "package" : "packages"}
          </p>
        </div>
        <Link href="/packages/new" className="btn btn-primary">
          + New package
        </Link>
      </div>

      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Duration</th>
              <th style={{ width: 200, textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((pkg) => (
              <tr key={pkg.id}>
                <td style={{ fontWeight: 500 }}>{pkg.name}</td>
                <td>
                  <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                    {pkg.category.map((c) => (
                      <span
                        key={c}
                        className="badge badge-open"
                        style={{ textTransform: "capitalize" }}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  {pkg.durationDays}D / {pkg.durationNights}N
                </td>
                <td style={{ textAlign: "right" }}>
                  <Link
                    href={`/packages/${pkg.id}`}
                    className="btn btn-secondary btn-sm"
                    style={{ marginRight: "0.5rem" }}
                  >
                    Edit
                  </Link>
                  <Link href={`/packages/${pkg.id}/batches`} className="btn btn-secondary btn-sm">
                    Batches
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <div className="empty-state">No packages yet.</div> : null}
      </div>
    </>
  );
}
