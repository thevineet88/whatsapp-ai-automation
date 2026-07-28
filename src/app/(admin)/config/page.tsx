import { tenants } from "@/lib/db/schema";
import { getServerDb } from "@/lib/db/serverDb";
import { getActiveTenantConfig, getHoldingReplyMessage } from "@/lib/db/tenantConfig";
import { updateTenantConfig } from "./actions";

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

  return (
    <main>
      <h1>Escalation contacts</h1>
      <p style={{ color: "#666" }}>
        Active config version: {config?.version ?? "none"}. Saving writes a new version; the
        previous one is kept, not overwritten.
      </p>

      {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}
      {saved ? <p style={{ color: "#0a7d34" }}>Saved.</p> : null}

      <form action={updateTenantConfig}>
        <label htmlFor="escalationContacts">One contact per line, format: Name, Phone</label>
        <br />
        <textarea
          id="escalationContacts"
          name="escalationContacts"
          rows={6}
          cols={40}
          defaultValue={contactsText}
          style={{ fontFamily: "inherit", fontSize: "1rem", marginTop: "0.5rem" }}
        />
        <br />

        <label htmlFor="holdingReplyMessage" style={{ display: "block", marginTop: "1.5rem" }}>
          Holding reply (sent to a traveller whenever the bot hands off to a human)
        </label>
        <br />
        <textarea
          id="holdingReplyMessage"
          name="holdingReplyMessage"
          rows={3}
          cols={40}
          defaultValue={holdingReplyMessage}
          style={{ fontFamily: "inherit", fontSize: "1rem", marginTop: "0.5rem" }}
        />
        <br />
        <button type="submit" style={{ marginTop: "1rem" }}>
          Save
        </button>
      </form>
    </main>
  );
}
