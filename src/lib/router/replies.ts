import type { batches, packages } from "@/lib/db/schema";
import type { BatchWithAvailability } from "@/lib/tools/packages";
import type { PaymentSchedule, PriceQuote } from "@/lib/tools/pricing";

type PackageRow = typeof packages.$inferSelect;
type BatchRow = typeof batches.$inferSelect;

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

function formatRupees(paise: number): string {
  const rupees = Math.round(paise / 100);
  return `Rs ${rupees.toLocaleString("en-IN")}`;
}

export function formatPackageListLine(pkg: Pick<PackageRow, "name">): string {
  return `- ${pkg.name}`;
}

export function clarifyPackageReply(candidates: Pick<PackageRow, "name">[]): string {
  const list = candidates.map(formatPackageListLine).join("\n");
  return `Which package are you asking about? We currently run:\n${list}`;
}

// Used when the message plausibly points at a couple of specific trips.
// Naming just those beats listing the whole catalogue back at someone who
// already told us roughly what they want.
export function clarifyBetweenCandidatesReply(candidates: Pick<PackageRow, "name">[]): string {
  const list = candidates.map(formatPackageListLine).join("\n");
  return `Just to make sure I give you the right details, which one did you mean?\n${list}`;
}

export const GREETING_REPLY =
  "Hello! Welcome to Samyati Holidays. I can help with trip dates, pricing, itineraries, inclusions and how booking works. Which trip are you interested in, or would you like to see what we're running?";

export function browsePackagesReply(candidates: Pick<PackageRow, "name">[]): string {
  const list = candidates.map(formatPackageListLine).join("\n");
  return `Here's what we're currently running:\n${list}\n\nTell me which one catches your eye and I'll share dates, pricing and the day-by-day plan.`;
}

export function notSupportedReply(candidates: Pick<PackageRow, "name">[]): string {
  const list = candidates.map(formatPackageListLine).join("\n");
  return `We don't currently run that destination. Here's what we do offer:\n${list}\n\nLet me know which one catches your eye and I'll share dates and pricing.`;
}

export function batchesReply(
  pkg: Pick<PackageRow, "name">,
  upcoming: BatchWithAvailability[],
): string {
  const lines = upcoming.slice(0, 5).map((batch) => {
    if (batch.isFull) {
      return `- ${formatDate(batch.departureDate)}: Sold out`;
    }
    const bookBy = batch.lastBookingDate ? `, book by ${formatDate(batch.lastBookingDate)}` : "";
    return `- ${formatDate(batch.departureDate)}: ${batch.seatsAvailable} seats available, starting from ${formatRupees(batch.startingPricePaise)} per person${bookBy}`;
  });

  return `Upcoming batches for ${pkg.name}:\n${lines.join("\n")}`;
}

// Answer for someone who named a trip without asking anything specific.
// Every figure comes from the tool layer; nothing here is generated.
export function packageOverviewReply(
  pkg: Pick<
    PackageRow,
    "name" | "durationDays" | "durationNights" | "departurePoint" | "travelMode" | "highlights"
  >,
  upcoming: BatchWithAvailability[],
): string {
  const lines = [
    `${pkg.name} is a ${pkg.durationDays} day, ${pkg.durationNights} night trip departing from ${pkg.departurePoint} by ${pkg.travelMode}.`,
  ];

  const highlights = pkg.highlights.slice(0, 4);
  if (highlights.length > 0) {
    lines.push("", "Highlights:", ...highlights.map((h) => `- ${h}`));
  }

  const open = upcoming.filter((b) => !b.isFull);
  if (open.length > 0) {
    const next = open[0];
    lines.push(
      "",
      `Next departure: ${formatDate(next.departureDate)}, starting from ${formatRupees(next.startingPricePaise)} per person (${next.seatsAvailable} seats left).`,
    );
    if (open.length > 1) {
      lines.push(`We have ${open.length} upcoming batches in total.`);
    }
  } else if (upcoming.length > 0) {
    lines.push("", "All currently listed batches are sold out, so let me check the next dates.");
  } else {
    lines.push("", "No upcoming batches are listed right now, so let me check the next dates.");
  }

  lines.push("", "Want the full day-by-day itinerary, inclusions, or all upcoming dates?");
  return lines.join("\n");
}

export function noUpcomingBatchesReply(pkg: Pick<PackageRow, "name">): string {
  return `There are no upcoming batches currently listed for ${pkg.name}. Let me check with our team and get back to you with the next available dates.`;
}

export function priceReply(
  pkg: Pick<PackageRow, "name">,
  batch: BatchRow,
  price: PriceQuote,
): string {
  const base = `${pkg.name} starts from ${formatRupees(price.startingPricePaise)} per person for the ${formatDate(batch.departureDate)} batch.`;

  if (price.variants.length === 0) {
    return base;
  }

  const variantLines = price.variants
    .map((variant) => `- ${variant.occupancyType}: ${formatRupees(variant.pricePaise)} per person`)
    .join("\n");

  return `${base}\nRoom-type pricing:\n${variantLines}`;
}

export function inclusionsExclusionsReply(
  pkg: Pick<PackageRow, "name" | "inclusions" | "exclusions">,
): string {
  const inclusions = pkg.inclusions.map((item) => `- ${item}`).join("\n");
  const exclusions = pkg.exclusions.map((item) => `- ${item}`).join("\n");
  return `${pkg.name} inclusions:\n${inclusions}\n\nExclusions:\n${exclusions}`;
}

export function itineraryReply(pkg: Pick<PackageRow, "name" | "itinerary">): string {
  const days = pkg.itinerary
    .map((day) => `Day ${day.day}: ${day.title}. ${day.description}`)
    .join("\n");
  return `${pkg.name} itinerary:\n${days}`;
}

export function departurePointReply(
  pkg: Pick<PackageRow, "name" | "departurePoint" | "travelMode" | "returnPoint">,
): string {
  return `${pkg.name} departs from ${pkg.departurePoint} and returns to ${pkg.returnPoint}, travelling by ${pkg.travelMode}.`;
}

export function durationReply(
  pkg: Pick<PackageRow, "name" | "durationDays" | "durationNights">,
): string {
  return `${pkg.name} is a ${pkg.durationDays} day, ${pkg.durationNights} night trip.`;
}

// Callers must check schedule.installments.length > 0 first; an empty
// schedule means there is no source to answer from and should escalate
// instead of calling this.
export function installmentsReply(
  pkg: Pick<PackageRow, "name">,
  schedule: PaymentSchedule,
): string {
  const lines = schedule.installments
    .map((i) => `- ${i.label}: ${formatRupees(i.amountPaise)}, due ${i.dueBy}`)
    .join("\n");

  return `Payment schedule for ${pkg.name}:\n${lines}\n${schedule.note}`;
}

// Callers must check schedule.cancellationPolicy.length > 0 first, same
// reasoning as installmentsReply above.
export function cancellationPolicyReply(
  pkg: Pick<PackageRow, "name">,
  schedule: PaymentSchedule,
): string {
  const lines = schedule.cancellationPolicy
    .map((rule) => `- ${rule.cutoff}: ${rule.deduction} deducted`)
    .join("\n");

  return `Cancellation policy for ${pkg.name}:\n${lines}\n${schedule.note}`;
}

export function noPaymentScheduleReply(pkg: Pick<PackageRow, "name">): string {
  return `The payment schedule for ${pkg.name} isn't finalized in our system yet. Let me check with our team and get back to you.`;
}

export const HOW_TO_BOOK_REPLY =
  "Booking works in installments: pay the first installment to confirm your seat (Rs 7,000 standard, as low as Rs 2,000 on select tours), and our team guides you through the rest on WhatsApp. Want me to share pricing and dates first, or connect you with the team to get started?";

const BOOKING_ESCALATION_REPLY =
  "Booking works in installments: pay the first installment to confirm your seat, and our team takes it from there. Connecting you with a team member now to get this moving.";

export function escalationReply(reason: string, holdingReplyMessage: string): string {
  switch (reason) {
    case "booking_or_payment":
      return BOOKING_ESCALATION_REPLY;
    default:
      return holdingReplyMessage;
  }
}
