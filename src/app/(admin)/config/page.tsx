import { tenants } from "@/lib/db/schema";
import { getServerDb } from "@/lib/db/serverDb";
import { getActiveTenantConfig, getHoldingReplyMessage } from "@/lib/db/tenantConfig";
import { updateTenantConfig } from "./actions";

// Server-rendered at request time so Next.js does not try to prerender this
// page during `next build` — which has no live database to query against.
export const dynamic = "force-dynamic";

export default async function ConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;

  const db = getServerDb();
  const [tenant] = await db.select().from(tenants).limit(1);

  if (!tenant) {
    return <p>No tenant found. Run the seed script first.</p>;
  }

  const config = await getActiveTenantConfig(db, tenant.id);
  const contactsText = (config?.escalationContacts ?? [])
    .map((contact) => `${contact.name}, ${contact.phone}`)
    .join("\n");
  const holdingReplyMessage = getHoldingReplyMessage(config);
  const existingAdminPassword =
    (config?.config as { adminPassword?: string } | undefined)?.adminPassword ?? "";
  const passwordHint = existingAdminPassword ? "(set — leave blank to keep current)" : "(not set)";

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Configuration</h1>
        <p className="page-subtitle">
          Active config version: <strong>{config?.version ?? "none"}</strong>. Saving writes a new
          version; the previous one is kept, not overwritten.
        </p>
      </div>

      {error ? <p className="text-error">{error}</p> : null}
      {saved ? <p className="text-success">Saved.</p> : null}

      <div className="card">
        <form action={updateTenantConfig}>
          <div className="field">
            <label className="field-label" htmlFor="escalationContacts">
              Escalation contacts
            </label>
            <p className="field-hint">One per line, format: Name, Phone</p>
            <textarea
              id="escalationContacts"
              name="escalationContacts"
              rows={6}
              defaultValue={contactsText}
              style={{ fontFamily: "monospace", marginTop: "0.5rem" }}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="holdingReplyMessage">
              Holding reply
            </label>
            <p className="field-hint">Sent to a traveller whenever the bot hands off to a human</p>
            <textarea
              id="holdingReplyMessage"
              name="holdingReplyMessage"
              rows={3}
              defaultValue={holdingReplyMessage}
              style={{ marginTop: "0.5rem" }}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="adminPassword">
              Admin panel password {passwordHint}
            </label>
            <p className="field-hint">Shared password for /admin access. At least 6 characters.</p>
            <input
              id="adminPassword"
              name="adminPassword"
              type="password"
              placeholder={
                existingAdminPassword
                  ? "Leave blank to keep current password"
                  : "At least 6 characters"
              }
              style={{ marginTop: "0.5rem" }}
            />
          </div>

          <div className="field">
            <button type="submit" className="btn btn-primary">
              Save configuration
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
