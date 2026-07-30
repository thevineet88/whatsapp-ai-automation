import { batchPriceVariants, batches, packages, tenants } from "@/lib/db/schema";
import { getServerDb } from "@/lib/db/serverDb";
import { and, asc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { createBatch, deleteBatch, updateBatch } from "./actions";

const pricePaise = (paise: number) => {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
};

export default async function BatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id: packageId } = await params;
  const { error, saved } = await searchParams;

  const db = getServerDb();
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) {
    return <p>No tenant found. Run the seed script first.</p>;
  }

  const [pkg] = await db
    .select()
    .from(packages)
    .where(and(eq(packages.id, packageId), eq(packages.tenantId, tenant.id)))
    .limit(1);

  if (!pkg) {
    return <p>Package not found.</p>;
  }

  const rows = await db
    .select()
    .from(batches)
    .where(and(eq(batches.packageId, packageId), eq(batches.tenantId, tenant.id)))
    .orderBy(asc(batches.departureDate));

  const variantRows =
    rows.length > 0
      ? await db
          .select()
          .from(batchPriceVariants)
          .where(
            inArray(
              batchPriceVariants.batchId,
              rows.map((batch) => batch.id),
            ),
          )
      : [];

  const variantsByBatch = new Map<string, typeof variantRows>();
  for (const variant of variantRows) {
    const existing = variantsByBatch.get(variant.batchId) ?? [];
    existing.push(variant);
    variantsByBatch.set(variant.batchId, existing);
  }

  const createBatchForPackage = createBatch.bind(null, packageId);

  return (
    <>
      <Link href={`/packages/${packageId}`} className="back-link">
        &larr; {pkg.name}
      </Link>

      <div className="page-header">
        <h1 className="page-title">Batches</h1>
        <p className="page-subtitle">
          {pkg.name} &middot; {rows.length} {rows.length === 1 ? "batch" : "batches"}
        </p>
      </div>

      {error ? <p className="text-error">{error}</p> : null}
      {saved ? <p className="text-success">Saved.</p> : null}

      <h2 className="section-title">Existing batches</h2>
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Departure</th>
              <th>Seats</th>
              <th>Starting price</th>
              <th>Last booking</th>
              <th>Status</th>
              <th style={{ width: 80 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((batch) => (
              <tr key={batch.id}>
                <td style={{ whiteSpace: "nowrap" }}>
                  <strong>{batch.departureDate}</strong>
                </td>
                <td>
                  {batch.seatsAvailable} / {batch.seatsTotal}
                </td>
                <td>{pricePaise(batch.startingPricePaise)}</td>
                <td>
                  {batch.lastBookingDate ?? (
                    <span style={{ color: "var(--muted-foreground)" }}>—</span>
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${batch.seatsAvailable <= 0 ? "badge-full" : "badge-available"}`}
                  >
                    {batch.seatsAvailable <= 0 ? "Full" : "Open"}
                  </span>
                </td>
                <td>
                  <form action={deleteBatch.bind(null, packageId, batch.id)}>
                    <button type="submit" className="btn btn-danger btn-sm">
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <div className="empty-state">No batches yet.</div> : null}
      </div>

      <h2 className="section-title">Add new batch</h2>
      <div className="card">
        <form action={createBatchForPackage} className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor="departureDate">
              Departure date
            </label>
            <input type="date" id="departureDate" name="departureDate" required />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="seatsTotal">
              Seats total
            </label>
            <input type="number" id="seatsTotal" name="seatsTotal" required />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="seatsAvailable">
              Seats available
            </label>
            <input type="number" id="seatsAvailable" name="seatsAvailable" required />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="startingPricePaise">
              Starting price (paise)
            </label>
            <input
              type="number"
              id="startingPricePaise"
              name="startingPricePaise"
              placeholder="e.g. 1500000 for ₹15,000"
              required
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="lastBookingDate">
              Last booking date (optional)
            </label>
            <input type="date" id="lastBookingDate" name="lastBookingDate" />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label className="field-label" htmlFor="priceVariants">
              Room-type prices (optional)
            </label>
            <textarea
              id="priceVariants"
              name="priceVariants"
              rows={3}
              placeholder="One per line: occupancy:pricePaise (e.g. double:1800000)"
            />
            <p className="field-hint">
              Format: occupancy:pricePaise, one per line. Leave blank if not needed.
            </p>
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <button type="submit" className="btn btn-primary">
              Add batch
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
