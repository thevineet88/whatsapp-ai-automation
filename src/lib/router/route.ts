import type { Db } from "@/lib/db/client";
import { packages } from "@/lib/db/schema";
import { listBatches } from "@/lib/tools/packages";
import { getPaymentSchedule, getPrice } from "@/lib/tools/pricing";
import { eq } from "drizzle-orm";
import { type KnownIntentType, classifyIntent } from "./intent";
import { resolvePackageFromText } from "./packageMatch";
import {
  HOW_TO_BOOK_REPLY,
  batchesReply,
  cancellationPolicyReply,
  clarifyPackageReply,
  departurePointReply,
  durationReply,
  escalationReply,
  inclusionsExclusionsReply,
  installmentsReply,
  itineraryReply,
  noPaymentScheduleReply,
  noUpcomingBatchesReply,
  priceReply,
} from "./replies";

const CLARIFICATION_LIMIT = 3;

export type ConversationRouteState = {
  packageId: string | null;
  pendingClarificationCount: number;
  status: "open" | "escalated" | "closed";
};

export type RouteResult = {
  replyText: string | null;
  nextPackageId: string | null;
  nextPendingClarificationCount: number;
  escalateReason: string | null;
};

const NO_REPLY: (state: ConversationRouteState) => RouteResult = (state) => ({
  replyText: null,
  nextPackageId: state.packageId,
  nextPendingClarificationCount: state.pendingClarificationCount,
  escalateReason: null,
});

export async function routeMessage(
  db: Db,
  tenantId: string,
  state: ConversationRouteState,
  holdingReplyMessage: string,
  text: string,
): Promise<RouteResult> {
  // Once a human is already engaged, stop auto-replying to avoid noise; the
  // traveller isn't left in silence because a human already has the thread.
  if (state.status === "escalated") {
    return NO_REPLY(state);
  }

  const intent = classifyIntent(text);

  if (intent.kind === "escalate") {
    return {
      replyText: escalationReply(intent.reason, holdingReplyMessage),
      nextPackageId: state.packageId,
      nextPendingClarificationCount: 0,
      escalateReason: intent.reason,
    };
  }

  if (intent.kind === "unclassified") {
    return {
      replyText: escalationReply("unclassified_message", holdingReplyMessage),
      nextPackageId: state.packageId,
      nextPendingClarificationCount: 0,
      escalateReason: "unclassified_message",
    };
  }

  if (intent.type === "how_to_book") {
    return {
      replyText: HOW_TO_BOOK_REPLY,
      nextPackageId: state.packageId,
      nextPendingClarificationCount: 0,
      escalateReason: null,
    };
  }

  const tenantPackages = await db.select().from(packages).where(eq(packages.tenantId, tenantId));
  const mentioned = resolvePackageFromText(text, tenantPackages);
  const anchored = mentioned ?? tenantPackages.find((p) => p.id === state.packageId) ?? null;

  if (!anchored) {
    const nextCount = state.pendingClarificationCount + 1;
    if (nextCount >= CLARIFICATION_LIMIT) {
      return {
        replyText: escalationReply("clarification_limit_reached", holdingReplyMessage),
        nextPackageId: null,
        nextPendingClarificationCount: nextCount,
        escalateReason: "clarification_limit_reached",
      };
    }
    return {
      replyText: clarifyPackageReply(tenantPackages),
      nextPackageId: state.packageId,
      nextPendingClarificationCount: nextCount,
      escalateReason: null,
    };
  }

  try {
    const outcome = await buildKnownIntentReply(db, tenantId, anchored, intent.type);
    return {
      replyText: outcome.text,
      nextPackageId: anchored.id,
      nextPendingClarificationCount: 0,
      escalateReason: outcome.escalateReason,
    };
  } catch {
    return {
      replyText: escalationReply("tool_error", holdingReplyMessage),
      nextPackageId: anchored.id,
      nextPendingClarificationCount: 0,
      escalateReason: "tool_error",
    };
  }
}

type Package = typeof packages.$inferSelect;

async function buildKnownIntentReply(
  db: Db,
  tenantId: string,
  pkg: Package,
  type: Exclude<KnownIntentType, "how_to_book">,
): Promise<{ text: string; escalateReason: string | null }> {
  switch (type) {
    case "batches": {
      const upcoming = await listBatches(db, tenantId, { packageId: pkg.id });
      if (upcoming.length === 0) {
        return { text: noUpcomingBatchesReply(pkg), escalateReason: "no_upcoming_batches" };
      }
      return { text: batchesReply(pkg, upcoming), escalateReason: null };
    }
    case "price": {
      const upcoming = await listBatches(db, tenantId, { packageId: pkg.id });
      if (upcoming.length === 0) {
        return { text: noUpcomingBatchesReply(pkg), escalateReason: "no_upcoming_batches" };
      }
      const chosen = upcoming.find((b) => !b.isFull) ?? upcoming[0];
      const price = await getPrice(db, tenantId, { batchId: chosen.id });
      if (!price) {
        return { text: noUpcomingBatchesReply(pkg), escalateReason: "no_upcoming_batches" };
      }
      return { text: priceReply(pkg, chosen, price), escalateReason: null };
    }
    case "inclusions_exclusions":
      return { text: inclusionsExclusionsReply(pkg), escalateReason: null };
    case "itinerary":
      return { text: itineraryReply(pkg), escalateReason: null };
    case "best_season":
      return {
        text: "Good question, let me check the seasonal details with our team and get back to you shortly.",
        escalateReason: "best_season_no_kb",
      };
    case "departure_point":
      return { text: departurePointReply(pkg), escalateReason: null };
    case "duration":
      return { text: durationReply(pkg), escalateReason: null };
    case "installments": {
      const schedule = await getPaymentSchedule(db, tenantId, { packageId: pkg.id });
      if (schedule.installments.length === 0) {
        return { text: noPaymentScheduleReply(pkg), escalateReason: "no_payment_schedule" };
      }
      return { text: installmentsReply(pkg, schedule), escalateReason: null };
    }
    case "cancellation_policy": {
      const schedule = await getPaymentSchedule(db, tenantId, { packageId: pkg.id });
      if (schedule.cancellationPolicy.length === 0) {
        return { text: noPaymentScheduleReply(pkg), escalateReason: "no_payment_schedule" };
      }
      return { text: cancellationPolicyReply(pkg, schedule), escalateReason: null };
    }
  }
}
