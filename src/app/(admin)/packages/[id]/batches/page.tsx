import { batchPriceVariants, batches, packages, tenants } from "@/lib/db/schema";
import { getServerDb } from "@/lib/db/serverDb";
import { and, asc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { createBatch, deleteBatch, updateBatch } from "./actions";

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
    <main>
      <p>
        <Link href={`/packages/${packageId}`}>&larr; {pkg.name}</Link>
        {" · "}
        <Link href={`/packages/${packageId}/payment-schedule`}>Payment schedule</Link>
      </p>
      <h1>Batches &mdash; {pkg.name}</h1>
      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}
      {saved ? <p style={{ color: "#0a7d34" }}>Saved.</p> : null}

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "2rem" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th style={{ padding: "0.4rem 0" }}>Departure</th>
            <th>Seats total</th>
            <th>Seats available</th>
            <th>Starting price (paise)</th>
            <th>Last booking date</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((batch) => {
            const updateBatchForRow = updateBatch.bind(null, packageId, batch.id);
            const deleteBatchForRow = deleteBatch.bind(null, packageId, batch.id);
            const isFull = batch.seatsAvailable <= 0;
            const variantsText = (variantsByBatch.get(batch.id) ?? [])
              .map((variant) => `${variant.occupancyType}:${variant.pricePaise}`)
              .join("\n");
            return (
              <tr key={batch.id} style={{ borderBottom: "1px solid #eee" }}>
                <td colSpan={7} style={{ padding: "0.5rem 0" }}>
                  <form
                    action={updateBatchForRow}
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                    }}
                  >
                    <input type="date" name="departureDate" defaultValue={batch.departureDate} />
                    <input
                      type="number"
                      name="seatsTotal"
                      defaultValue={batch.seatsTotal}
                      style={{ width: 90 }}
                    />
                    <input
                      type="number"
                      name="seatsAvailable"
                      defaultValue={batch.seatsAvailable}
                      style={{ width: 100 }}
                    />
                    <input
                      type="number"
                      name="startingPricePaise"
                      defaultValue={batch.startingPricePaise}
                      style={{ width: 130 }}
                    />
                    <input
                      type="date"
                      name="lastBookingDate"
                      defaultValue={batch.lastBookingDate}
                    />
                    <textarea
                      name="priceVariants"
                      rows={2}
                      placeholder="Room-type prices, optional. One per line: occupancy:pricePaise"
                      defaultValue={variantsText}
                      style={{ width: 260 }}
                    />
                    <span style={{ color: isFull ? "#b00020" : "#0a7d34" }}>
                      {isFull ? "Full" : "Open"}
                    </span>
                    <button type="submit">Save</button>
                  </form>
                  <form action={deleteBatchForRow} style={{ marginTop: "0.25rem" }}>
                    <button type="submit">Delete</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 ? <p>No batches yet.</p> : null}

      <h2>Add batch</h2>
      <form
        action={createBatchForPackage}
        style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}
      >
        <label>
          Departure
          <br />
          <input type="date" name="departureDate" required />
        </label>
        <label>
          Seats total
          <br />
          <input type="number" name="seatsTotal" required style={{ width: 90 }} />
        </label>
        <label>
          Seats available
          <br />
          <input type="number" name="seatsAvailable" required style={{ width: 100 }} />
        </label>
        <label>
          Starting price (paise)
          <br />
          <input type="number" name="startingPricePaise" required style={{ width: 130 }} />
        </label>
        <label>
          Last booking date
          <br />
          <input type="date" name="lastBookingDate" required />
        </label>
        <label>
          Room-type prices (optional, one per line: occupancy:pricePaise)
          <br />
          <textarea name="priceVariants" rows={2} style={{ width: 260 }} />
        </label>
        <button type="submit">Add</button>
      </form>
    </main>
  );
}
