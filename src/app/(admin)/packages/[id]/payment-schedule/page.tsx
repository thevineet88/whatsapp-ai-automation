import {
  cancellationRules,
  packages,
  paymentInstallments,
  tenants,
} from "@/lib/db/schema";
import { getServerDb } from "@/lib/db/serverDb";
import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import {
  addCancellationRule,
  addInstallment,
  deleteCancellationRule,
  deleteInstallment,
} from "./actions";

export default async function PaymentSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id: packageId } = await params;
  const { error } = await searchParams;

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

  const installments = await db
    .select()
    .from(paymentInstallments)
    .where(
      and(
        eq(paymentInstallments.packageId, packageId),
        eq(paymentInstallments.tenantId, tenant.id),
      ),
    )
    .orderBy(asc(paymentInstallments.sequence));

  const rules = await db
    .select()
    .from(cancellationRules)
    .where(
      and(eq(cancellationRules.packageId, packageId), eq(cancellationRules.tenantId, tenant.id)),
    )
    .orderBy(asc(cancellationRules.sequence));

  const addInstallmentForPackage = addInstallment.bind(null, packageId);
  const addCancellationRuleForPackage = addCancellationRule.bind(null, packageId);
  const nextInstallmentSequence =
    installments.length > 0 ? Math.max(...installments.map((i) => i.sequence)) + 1 : 1;
  const nextRuleSequence =
    rules.length > 0 ? Math.max(...rules.map((r) => r.sequence)) + 1 : 1;

  return (
    <>
      <Link href={`/packages/${packageId}`} className="back-link">
        &larr; {pkg.name}
      </Link>

      <div className="page-header">
        <h1 className="page-title">Payment schedule</h1>
        <p className="page-subtitle">
          {pkg.name} &middot; Installments and cancellation policy
        </p>
      </div>

      {error ? <p className="text-error">{error}</p> : null}

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>Installments</h2>
        {installments.length === 0 ? (
          <p style={{ color: "var(--muted-foreground)", fontSize: "0.875rem" }}>No installments yet.</p>
        ) : (
          <div className="table-wrapper" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>#</th>
                  <th>Label</th>
                  <th>Amount</th>
                  <th>Due by</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {installments.map((installment) => (
                  <tr key={installment.id}>
                    <td style={{ fontWeight: 500 }}>{installment.sequence}</td>
                    <td>{installment.label}</td>
                    <td>{pricePaise(installment.amountPaise)}</td>
                    <td>{installment.dueBy}</td>
                    <td>
                      <form action={deleteInstallment.bind(null, packageId, installment.id)}>
                        <button type="submit" className="btn btn-danger btn-sm">
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: "1rem" }}>
          <form
            action={addInstallmentForPackage}
            className="form-grid"
          >
            <div className="field">
              <label className="field-label" htmlFor="sequence">#</label>
              <input
                type="number"
                id="sequence"
                name="sequence"
                defaultValue={nextInstallmentSequence}
                style={{ width: 60 }}
                required
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="label">Label</label>
              <input
                type="text"
                id="label"
                name="label"
                placeholder="1st Installment"
                required
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="amountPaise">Amount (paise)</label>
              <input
                type="number"
                id="amountPaise"
                name="amountPaise"
                placeholder="700000"
                required
              />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label className="field-label" htmlFor="dueBy">Due by</label>
              <input
                type="text"
                id="dueBy"
                name="dueBy"
                placeholder="At the time of booking"
                required
              />
            </div>
            <div className="field">
              <button type="submit" className="btn btn-primary">
                Add installment
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title" style={{ marginTop: 0 }}>Refund &amp; cancellation policy</h2>
        <p style={{ color: "var(--muted-foreground)", fontSize: "0.875rem", margin: "0 0 1rem 0" }}>
          Note: The first installment is non-refundable in all cases.
        </p>

        {rules.length === 0 ? (
          <p style={{ color: "var(--muted-foreground)", fontSize: "0.875rem" }}>
            No cancellation rules yet.
          </p>
        ) : (
          <div className="table-wrapper" style={{ border: "none", borderRadius: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>#</th>
                  <th>Cutoff</th>
                  <th>Deduction</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td style={{ fontWeight: 500 }}>{rule.sequence}</td>
                    <td>{rule.cutoff}</td>
                    <td>{rule.deduction}</td>
                    <td>
                      <form action={deleteCancellationRule.bind(null, packageId, rule.id)}>
                        <button type="submit" className="btn btn-danger btn-sm">
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form
          action={addCancellationRuleForPackage}
          className="form-grid"
          style={{ marginTop: "1rem" }}
        >
          <div className="field">
            <label className="field-label" htmlFor="sequence">#</label>
            <input
              type="number"
              id="sequence"
              name="sequence"
              defaultValue={nextRuleSequence}
              style={{ width: 60 }}
              required
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="cutoff">Cutoff</label>
            <input
              type="text"
              id="cutoff"
              name="cutoff"
              placeholder="45+ days before departure"
              required
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="deduction">Deduction</label>
            <input
              type="text"
              id="deduction"
              name="deduction"
              placeholder="25% of package cost"
              required
            />
          </div>
          <div className="field">
            <button type="submit" className="btn btn-primary">
              Add rule
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function pricePaise(paise: number) {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
}