import { FIRST_INSTALLMENT_NON_REFUNDABLE_NOTE } from "@/lib/core/pricing";
import { cancellationRules, packages, paymentInstallments, tenants } from "@/lib/db/schema";
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
  const nextRuleSequence = rules.length > 0 ? Math.max(...rules.map((r) => r.sequence)) + 1 : 1;

  return (
    <main>
      <p>
        <Link href={`/packages/${packageId}`}>&larr; {pkg.name}</Link>
        {" · "}
        <Link href={`/packages/${packageId}/batches`}>Batches</Link>
      </p>
      <h1>Payment schedule &mdash; {pkg.name}</h1>
      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}

      <h2>Installments</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "1rem" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th style={{ padding: "0.4rem 0" }}>#</th>
            <th>Label</th>
            <th>Amount (paise)</th>
            <th>Due by</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {installments.map((installment) => {
            const deleteInstallmentForRow = deleteInstallment.bind(null, packageId, installment.id);
            return (
              <tr key={installment.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.4rem 0" }}>{installment.sequence}</td>
                <td>{installment.label}</td>
                <td>{installment.amountPaise}</td>
                <td>{installment.dueBy}</td>
                <td>
                  <form action={deleteInstallmentForRow}>
                    <button type="submit">Delete</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {installments.length === 0 ? <p>No installments yet.</p> : null}

      <form
        action={addInstallmentForPackage}
        style={{
          display: "flex",
          gap: "0.5rem",
          alignItems: "flex-end",
          flexWrap: "wrap",
          marginBottom: "2rem",
        }}
      >
        <label>
          #<br />
          <input
            type="number"
            name="sequence"
            defaultValue={nextInstallmentSequence}
            style={{ width: 60 }}
            required
          />
        </label>
        <label>
          Label
          <br />
          <input
            type="text"
            name="label"
            placeholder="1st Installment"
            required
            style={{ width: 160 }}
          />
        </label>
        <label>
          Amount (paise)
          <br />
          <input
            type="number"
            name="amountPaise"
            placeholder="700000"
            required
            style={{ width: 130 }}
          />
        </label>
        <label>
          Due by
          <br />
          <input
            type="text"
            name="dueBy"
            placeholder="At the time of booking"
            required
            style={{ width: 220 }}
          />
        </label>
        <button type="submit">Add installment</button>
      </form>

      <h2>Refund &amp; cancellation policy</h2>
      <p style={{ color: "#666" }}>{FIRST_INSTALLMENT_NON_REFUNDABLE_NOTE}</p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "1rem" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th style={{ padding: "0.4rem 0" }}>#</th>
            <th>Cutoff</th>
            <th>Deduction</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => {
            const deleteRuleForRow = deleteCancellationRule.bind(null, packageId, rule.id);
            return (
              <tr key={rule.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.4rem 0" }}>{rule.sequence}</td>
                <td>{rule.cutoff}</td>
                <td>{rule.deduction}</td>
                <td>
                  <form action={deleteRuleForRow}>
                    <button type="submit">Delete</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rules.length === 0 ? <p>No cancellation rules yet.</p> : null}

      <form
        action={addCancellationRuleForPackage}
        style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap" }}
      >
        <label>
          #<br />
          <input
            type="number"
            name="sequence"
            defaultValue={nextRuleSequence}
            style={{ width: 60 }}
            required
          />
        </label>
        <label>
          Cutoff
          <br />
          <input
            type="text"
            name="cutoff"
            placeholder="45+ days before departure"
            required
            style={{ width: 220 }}
          />
        </label>
        <label>
          Deduction
          <br />
          <input
            type="text"
            name="deduction"
            placeholder="25% of package cost"
            required
            style={{ width: 220 }}
          />
        </label>
        <button type="submit">Add rule</button>
      </form>
    </main>
  );
}
