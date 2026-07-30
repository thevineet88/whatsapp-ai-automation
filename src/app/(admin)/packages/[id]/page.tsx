import { packages, tenants } from "@/lib/db/schema";
import { getServerDb } from "@/lib/db/serverDb";
import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { PackageForm } from "../PackageForm";
import { deletePackage, updatePackage } from "../actions";

export default async function EditPackagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;

  const db = getServerDb();
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) {
    return <p>No tenant found. Run the seed script first.</p>;
  }

  const [pkg] = await db
    .select()
    .from(packages)
    .where(and(eq(packages.id, id), eq(packages.tenantId, tenant.id)))
    .limit(1);

  if (!pkg) {
    return <p>Package not found.</p>;
  }

  const updatePackageWithId = updatePackage.bind(null, pkg.id);
  const deletePackageWithId = deletePackage.bind(null, pkg.id);

  return (
    <>
      <Link href="/packages" className="back-link">
        &larr; All packages
      </Link>

      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h1 className="page-title">{pkg.name}</h1>
          <p className="page-subtitle">
            Edit package details, manage batches and payment schedule
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link href={`/packages/${pkg.id}/batches`} className="btn btn-secondary">
            Manage batches
          </Link>
          <Link href={`/packages/${pkg.id}/payment-schedule`} className="btn btn-secondary">
            Payment schedule
          </Link>
        </div>
      </div>

      {error ? <p className="text-error">{error}</p> : null}
      {saved ? <p className="text-success">Saved.</p> : null}

      <div className="card">
        <PackageForm action={updatePackageWithId} defaults={pkg} submitLabel="Save changes" />
      </div>

      <div style={{ marginTop: "2rem", paddingTop: "1.5rem", borderTop: "1px solid var(--border)" }}>
        <form action={deletePackageWithId}>
          <button type="submit" className="btn btn-danger">
            Delete package
          </button>
          <p className="field-hint" style={{ marginTop: "0.5rem" }}>
            Deleting will also remove all batches, payment schedules, and cancellation rules.
          </p>
        </form>
      </div>
    </>
  );
}