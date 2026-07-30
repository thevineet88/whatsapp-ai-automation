import { tenants } from "@/lib/db/schema";
import { getServerDb } from "@/lib/db/serverDb";
import Link from "next/link";
import { listConversations } from "./actions";

const STATUSES = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "awaiting_human", label: "Awaiting" },
  { value: "human_active", label: "In Progress" },
] as const;

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const db = getServerDb();
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) return <p>No tenant found.</p>;

  const conversations = await listConversations(status ?? "");
  const activeStatus = status ?? "";

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Conversations</h1>
        <p className="page-subtitle">
          {conversations.length} {conversations.length === 1 ? "conversation" : "conversations"}
        </p>
      </div>
      <div className="filter-group">
        {STATUSES.map((s) => {
          const href = s.value ? `/conversations?status=${s.value}` : "/conversations";
          return (
            <Link
              key={s.value}
              href={href}
              className={`filter-pill ${activeStatus === s.value ? "active" : ""}`}
            >
              {s.label}
            </Link>
          );
        })}
      </div>
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Traveller</th>
              <th>Status</th>
              <th>Last message</th>
              <th>Escalation</th>
              <th style={{ width: 80 }} />
            </tr>
          </thead>
          <tbody>
            {conversations.map((conv) => (
              <tr key={conv.id}>
                <td>
                  <Link href={`/conversations/${conv.id}`} className="link">
                    {maskPhone(conv.travellerPhone)}
                  </Link>
                </td>
                <td>
                  <span className={`badge badge-${conv.status}`}>{labelFor(conv.status)}</span>
                </td>
                <td
                  style={{
                    maxWidth: 280,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {conv.lastMessagePreview}
                </td>
                <td
                  style={{
                    color: conv.escalationReason ? "var(--foreground)" : "var(--muted-foreground)",
                  }}
                >
                  {conv.escalationReason ?? "—"}
                </td>
                <td>
                  <Link href={`/conversations/${conv.id}`} className="link">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {conversations.length === 0 ? (
          <div className="empty-state">No conversations found.</div>
        ) : null}
      </div>
    </>
  );
}

function maskPhone(phone: string): string {
  return phone.length <= 4 ? "****" : `****${phone.slice(-4)}`;
}

function labelFor(status: string): string {
  switch (status) {
    case "open":
      return "Open";
    case "awaiting_human":
      return "Awaiting";
    case "human_active":
      return "In Progress";
    case "escalated":
      return "Escalated";
    default:
      return status;
  }
}
