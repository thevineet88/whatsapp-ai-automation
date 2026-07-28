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
    <main>
      <h1>Edit package</h1>
      <p>
        <Link href={`/packages/${pkg.id}/batches`}>Manage batches &rarr;</Link>
        {" · "}
        <Link href={`/packages/${pkg.id}/payment-schedule`}>Payment schedule &rarr;</Link>
      </p>
      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}
      {saved ? <p style={{ color: "#0a7d34" }}>Saved.</p> : null}

      <PackageForm action={updatePackageWithId} defaults={pkg} submitLabel="Save changes" />

      <form
        action={deletePackageWithId}
        style={{ marginTop: "2rem", borderTop: "1px solid #eee", paddingTop: "1rem" }}
      >
        <button type="submit">Delete package</button>
      </form>
    </main>
  );
}
