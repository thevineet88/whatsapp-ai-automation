import {
  getConversationThread,
  takeOverConversation,
  returnToBot,
  sendAdminReply,
} from "../actions";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function ConversationThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { id } = await params;
  const { error, sent } = await searchParams;

  const result = await getConversationThread(id);
  if (!result) return <p>Conversation not found.</p>;
  const { conversation, thread, escalations: escalationList } = result;

  async function takeOver() {
    "use server";
    const r = await takeOverConversation(id);
    if (!r.ok) redirect(`/conversations/${id}?error=${encodeURIComponent(r.error)}`);
    redirect(`/conversations/${id}`);
  }

  async function returnToBotHandler() {
    "use server";
    const r = await returnToBot(id);
    if (!r.ok) redirect(`/conversations/${id}?error=${encodeURIComponent(r.error)}`);
    redirect(`/conversations/${id}`);
  }

  async function reply(formData: FormData) {
    "use server";
    const r = await sendAdminReply(id, formData);
    if (!r.ok) redirect(`/conversations/${id}?error=${encodeURIComponent(r.error)}`);
    redirect(`/conversations/${id}?sent=1`);
  }

  const isHumanActive = conversation.status === "human_active";
  // Take Over is available when the bot is still handling things: open,
  // awaiting_human, or escalated. Once an admin has taken over, hide it.
  const canTakeOver =
    conversation.status === "open" ||
    conversation.status === "awaiting_human" ||
    conversation.status === "escalated";
  // Return to Bot is the inverse: only when an admin is currently handling
  // the thread. There is no longer any way to permanently close a conversation.
  const canReturnToBot = conversation.status === "human_active";

  // Collector escalations are each their own row. Surface them all so the
  // team sees every custom-package or booking request as a separate
  // line item, not collapsed into one.
  const collectorEscalations = escalationList.filter(
    (e) => e.reason === "custom_package_request" || e.reason === "booking_request",
  );

  return (
    <>
      <Link href="/conversations" className="back-link">
        &larr; All conversations
      </Link>

      <div className="conversation-header">
        <h1>
          Conversation with{" "}
          <span style={{ fontFamily: "monospace" }}>{maskPhone(conversation.travellerPhone)}</span>
        </h1>
        <span className={`badge badge-${conversation.status}`}>
          {labelFor(conversation.status)}
        </span>
      </div>

      {error ? <p className="text-error">{error}</p> : null}
      {sent ? <p className="text-success">Reply sent to traveller.</p> : null}

      {collectorEscalations.length > 0 ? (
        <div className="escalation-detail-banner">
          <strong>Collector requests ({collectorEscalations.length}):</strong>
          <div style={{ marginTop: 8 }}>
            {collectorEscalations.map((esc, i) => (
              <div key={esc.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < collectorEscalations.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div style={{ fontSize: "0.8rem", color: "var(--muted-foreground)", marginBottom: 6 }}>
                  {labelForEscalation(esc.reason)} · {new Date(esc.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                </div>
                {esc.detail ? (
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem", margin: 0 }}>
                    {esc.detail}
                  </pre>
                ) : (
                  <span style={{ color: "var(--muted-foreground)" }}>No structured data captured.</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {conversation.phase ? (
        <div className="collector-banner">
          <strong>Collecting:</strong> {labelForPhase(conversation.phase)}
        </div>
      ) : null}

      <div className="thread">
        {thread.length === 0 ? (
          <p style={{ color: "var(--muted-foreground)", textAlign: "center" }}>No messages yet.</p>
        ) : (
          thread.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>

      <div className="action-bar">
        {canTakeOver ? (
          <form action={takeOver}>
            <button type="submit" className="btn btn-primary">
              Take Over
            </button>
          </form>
        ) : null}
        {canReturnToBot ? (
          <form action={returnToBotHandler}>
            <button type="submit" className="btn btn-success">
              Return to Bot
            </button>
          </form>
        ) : null}
        {isHumanActive ? (
          <span style={{ fontSize: "0.875rem", color: "var(--muted-foreground)" }}>
            You are handling this conversation. The bot is paused.
          </span>
        ) : null}
      </div>

      <form action={reply} className="reply-form">
        <label htmlFor="replyText" className="field-label">
          Reply to traveller
        </label>
        <textarea
          id="replyText"
          name="replyText"
          placeholder="Type your reply here. Sends to the traveller via WhatsApp."
          required
        />
        <div className="reply-form-footer">
          <button type="submit" className="btn btn-primary">
            Send reply
          </button>
        </div>
      </form>
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
      return "Awaiting human";
    case "human_active":
      return "In progress";
    case "escalated":
      return "Escalated";
    default:
      return status;
  }
}

function labelForPhase(phase: string): string {
  switch (phase) {
    case "collecting_custom_package":
      return "Custom package request";
    case "collecting_booking":
      return "Booking request";
    default:
      return phase;
  }
}

function labelForEscalation(reason: string): string {
  switch (reason) {
    case "custom_package_request":
      return "Custom package request";
    case "booking_request":
      return "Booking request";
    default:
      return reason;
  }
}

function MessageBubble({ message }: { message: any }) {
  const isInbound = message.direction === "inbound";
  const isAdmin = message.isAdminReply;
  const cls = isInbound ? "bubble-inbound" : isAdmin ? "bubble-admin" : "bubble-bot";
  const align = isInbound ? "left" : "right";

  return (
    <div className={`bubble-row ${align}`}>
      <div className={`bubble ${cls}`}>
        <div className="bubble-meta">
          {isInbound ? "Traveller" : isAdmin ? "Admin" : "Bot"}
          {message.escalationReason ? ` · ${message.escalationReason}` : ""} ·{" "}
          {new Date(message.createdAt).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "short",
          })}
        </div>
        <div className="bubble-content">{message.content}</div>
      </div>
    </div>
  );
}