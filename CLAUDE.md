# CLAUDE.md

## What this is

A WhatsApp automation system for Samyati Holidays, a Mumbai and Pune based
group tour operator. Travellers message the business on WhatsApp. The system
answers factual questions about packages from a knowledge base, answers
departure dates, seat availability, and pricing from real data, and hands off
to a human when it should not answer.

One tenant today. Data model stays tenant-scoped regardless, per the scope
discipline section below.

## Business context (from samyatiholidays.com)

Samyati runs fully organized group tours from Mumbai and Pune: spiritual
yatras (Kedarnath-Badrinath), beach trips (Gokarna-Murudeshwar), high-altitude
adventure (Sikkim-Darjeeling), plus Himalayan treks, Char Dham circuits, Ladies
Special and Parents Special tours. Tagline is "Feeling FamilyVali." Current
WhatsApp contact is +91 90760 68549. Human team: Rohit, Shrutika, Tejashree.
This bot's job is to absorb the repetitive first-touch questions currently
landing on that one number, and to escalate to that same human team when it
should.

The existing package-detail page structure is the closest thing to a real spec
this project has. Model the trip schema after it directly rather than inventing
a structure:

- **Trip Highlights** — short bullet summary
- **Important Advisory** — altitude, weather, fitness caveats specific to
  the trip
- **Flight Information** — where relevant, optional per trip
- **Travel Details** — Departure point, Train/Mode, Return point
- **Day-by-Day Itinerary** — ordered list of day entries
- **Inclusions** and **Exclusions** — two separate lists
- **Payment Schedule** — table of installment, amount, due-by date
- **Refund & Cancellation Policy** — table of cancellation date cutoff to
  amount deducted, plus the standing rule that the first installment is
  non-refundable in all cases
- **Points to Note** — standing operational disclaimers (conduct, weather
  contingency, liability limits, seating, personal expenses at stops)
- Summary fields: Starting from (price), Dates, Duration, Last Booking date

A package can have multiple **batches** (dated departures), each with its own
starting price, seats, and last booking date, sharing one itinerary and one set
of inclusions/exclusions.

## Domain notes

This is fixed-departure group travel, not a hotel or rental. That shapes the
data model:

- A **package** is the product (for example "Kedarnath-Badrinath Yatra"). It
  has the itinerary, inclusions, exclusions, advisory, points to note, category
  (Spiritual, Beach, Adventure, Nature, Ladies Special, Parents Special), and a
  duration in days and nights.
- A **batch** is a dated departure of a package, with its own seat count,
  starting price, and last-booking-date cutoff. One package has many batches.
  Availability means seats on a batch, not nights in a calendar.
- **Pricing is per person**, shown as a "starting from" figure that varies by
  occupancy or room type on request. There is no per-night rate.
- **Booking flow is installment-based, not full payment.** Standard flow is a
  ₹7,000 first installment (as low as ₹2,000 on budget tours) followed by
  scheduled installments before departure, per the package's own payment
  schedule table. The first installment is always non-refundable.
- **Seasonality is a top-volume question.** "Best time for X", "will it be
  cold", "is this trip good in monsoon". Factual knowledge base content, not a
  tool call, and should be seeded early per package.
- **Fitness, age, and medical suitability questions carry liability.** Anything
  about knees, age, children, senior citizens, asthma, pregnancy, altitude
  sickness, or prior injury escalates to a human every time. The bot does not
  assess anyone's fitness, even though the site markets itself as accommodating
  kids and senior citizens; that judgment call stays human.
- **The bot never takes a booking or payment.** It confirms interest, shares
  batch and pricing detail, and escalates to the human team with full context
  attached, same as "Book on WhatsApp" does today.
- **Traffic is spiky around season launches** for specific packages (Char Dham
  season, Sikkim season), so marketing templates and opt-in records matter more
  here than for a single static property.

## Scope discipline

This is deliberately built as a single-tenant system with a multi-tenant data
model. That distinction is the design philosophy of this repo.

**Do this:** every table carries `tenant_id`. All settings live in a database
config row, never in code or environment variables. Meta's `phone_number_id`
resolves to a tenant through a lookup table.

**Do not do this:** Row Level Security policies, multi-org authentication,
tenant onboarding flows, admin tenant switchers, a monorepo, or any abstraction
whose only justification is a second client.

The reasoning: adding `tenant_id` later means a painful migration on live
traveller data. Adding RLS later is an afternoon. Build the expensive-to-defer
thing, defer the cheap-to-add thing. If a suggestion does not clearly fall on
one side of that line, ask before building it.

## Stack

- Next.js 15 App Router. Serves the admin panel and the WhatsApp webhook route.
- A separate worker entry point in the same repo, run as its own process.
- Postgres 16 with pgvector. Drizzle ORM.
- Redis with BullMQ for the job queue.
- Vercel AI SDK for LLM calls. Zod for all schemas.
- Deployed on Railway, Mumbai or Singapore region, as two services from one repo.
- Not Vercel. The webhook needs a warm persistent server and the worker needs to
  be long-running.

## Layout

```
src/
  app/
    api/webhook/whatsapp/route.ts   Receive, verify, dedupe, enqueue, 200.
    (admin)/                        Admin panel routes.
  worker/
    index.ts                        BullMQ consumer entry point.
    handlers/                       Job handlers.
  lib/
    db/          Drizzle schema, migrations, client.
    whatsapp/    Cloud API client. Send, templates, error mapping.
    rag/         Chunking, embedding, hybrid retrieval.
    llm/         AI SDK wrappers, prompts, structured output schemas.
    tools/       Package search, batches, pricing. Deterministic, no LLM.
    guardrails/  Confidence gate, citation validation, escalation rules.
    core/        Shared Zod schemas and domain types. No I/O.
```

`core` imports nothing else. Everything else may import it.

## Non-negotiable invariants

Violating any of these is a bug, regardless of whether tests pass.

1. **Prices, batch dates, and seat availability never come from an LLM.** They
   come from the tool layer, which queries the database. The LLM may only
   phrase a value a tool returned. If no tool ran, the bot does not state a
   price, a date, or a seat count.

2. **No answer without a source.** Every generated answer carries a non-empty
   `sources[]` of knowledge chunk IDs that were actually in the retrieved set.
   Empty sources, or an ID that was not retrieved, means discard and escalate.

3. **The bot never assesses fitness, health, age, or medical suitability.** Any
   such question escalates immediately, with no generated answer at all, not
   even a hedged one.

4. **The bot never takes a booking or handles payment.** Booking intent
   escalates to Rohit, Shrutika, or Tejashree per the config, with the
   conversation context attached, matching the site's existing "Book on
   WhatsApp" behaviour.

5. **Every table has `tenant_id`.** Every query filters on it. No exceptions.

6. **The webhook returns 200 in under 2 seconds, always.** Verify signature,
   dedupe, enqueue, return. No LLM work, no retrieval, no other writes.

7. **Every inbound message is processed exactly once.** Idempotency keyed on
   Meta's `message.id`. Meta retries. Duplicates must be impossible.

8. **The traveller is never left in silence.** On any LLM or tool failure, send
   a graceful holding reply and notify the escalation contact. Sending nothing
   is worse than a wrong answer.

9. **No secrets in code or logs.** Access tokens encrypted at rest. Traveller
   phone numbers masked in logs, never plaintext.

## The tool layer

Fixed and small. The LLM cannot call anything outside this set.

- `search_packages(category?, month?, region?, duration?)` returns matching
  packages, mirroring the site's category tags (Spiritual, Beach, Adventure,
  Nature, Ladies Special, Parents Special).
- `list_batches(package_id, from_date?)` returns upcoming dated batches with
  seats remaining and last-booking-date.
- `get_price(batch_id)` returns the starting price and, where the package
  defines room-type variants, the per-occupancy breakdown. Pure function over
  database rows.
- `check_seats(batch_id)` returns current availability.
- `get_payment_schedule(package_id)` returns the installment table as stored,
  never generated.

A batch with zero seats is reported as full, and the bot offers the next batch
of the same package.

## The answer pipeline

1. Resolve tenant from `phone_number_id`. Load the config row, version-pinned.
2. Load conversation state from Redis, falling back to Postgres.
3. Classify intent. Package search, batches, pricing, seats, and payment
   schedule route to the tool layer, never to retrieval.
4. Hybrid retrieval: pgvector similarity plus Postgres full-text, then rerank,
   filtered by `package_id` when the conversation is already anchored to one.
5. Retrieval gate. If the top score is below threshold, do not call the LLM.
   Escalate.
6. `generateObject` with the answer schema, temperature at or below 0.3.
7. Guardrail pass. Validate every source ID against the retrieved set.
8. Send, or escalate.
9. Persist the full trace: tool calls and results, retrieved chunks, prompt
   version, config version, model, token counts, latency.

Step 9 is not optional. Without it a wrong answer cannot be debugged.

## Escalation triggers (hardcoded, not model-decided)

- Any fitness, health, injury, age suitability, or medical question
- Booking intent, payment, or refund request
- Complaint, safety concern, or damage language
- Retrieval confidence below threshold
- `needs_human: true` in the structured output
- Third consecutive clarifying question in one conversation
- Explicit request for a human
- Any LLM or tool error

## Knowledge base content types

Seed these before step 8, in this priority order, structured per package where
the site itself structures them per package:

1. Trip Highlights and Day-by-Day Itinerary, per package
2. Inclusions and Exclusions, per package
3. Important Advisory (altitude, weather, fitness caveats), per package
4. Best season and weather notes, per package and region
5. Travel Details: Departure point, Train/Mode, Return point
6. Points to Note (standing operational disclaimers), shared across packages
   unless a package overrides one
7. Payment Schedule and Refund & Cancellation Policy tables, per package,
   stored as structured data and served by the tool layer, not retrieval
8. Permits, ID requirements, connectivity, and altitude notes, where relevant

Each chunk carries `package_id` where package-specific, or null where general
(company policy, how installments work generally), so retrieval can filter by
the package under discussion.

## Conventions

- TypeScript strict. No `any`. No non-null assertions without a comment.
- Zod schemas in `core` are the source of truth. Infer types from them.
- Drizzle only. Raw SQL only for vector and full-text queries, parameterised.
- Money in integer paise, never floats. Batch dates as `date` in IST, not
  timestamps.
- Typed result objects at module boundaries, not thrown exceptions.
- Every external call has a timeout and a retry policy.
- Structured JSON logs with `tenant_id`, `conversation_id`, `trace_id`.
- Biome for lint and format.

## Testing

- Vitest. Testcontainers for Postgres and Redis on integration tests.
- The webhook handler has a test for duplicate delivery and one for a forged
  signature. Not optional.
- The pricing and payment schedule functions have exhaustive unit coverage.
  They handle money.
- A test proving a zero-seat batch is never offered as available.
- Playwright for admin panel critical paths, added at step 11.

## Build order

Do not build ahead of this order. Each step works before the next begins.

1. Repo, Docker Compose (Postgres with pgvector, Redis), Drizzle schema with
   `tenant_id` throughout, migrations, CI, Biome, Vitest.
2. Webhook route: signature verification, dedupe, enqueue, 200. Verified live
   against Meta's test number through a tunnel.
3. Worker process, WhatsApp send client, working echo bot end to end.
4. Config row model plus a minimal admin page to edit it.
5. Package and batch catalogue: schema modeled on the package-detail structure
   above, admin CRUD screens, and the tool layer for search, batches, and
   seats.
6. Pricing and payment schedule: starting price, installment table, refund
   and cancellation table, stored as structured data per package.
7. Intent router with hardcoded replies for the top ten traveller questions:
   upcoming batches for a package, starting price, inclusions and exclusions,
   itinerary summary, best season, departure and pickup point, duration, how
   installments work, how to book, cancellation policy.
   **Ship here. Run it live for Samyati. Log every message it could not
   answer.**
8. Knowledge base ingestion, chunking, embedding, hybrid retrieval.
9. LLM answer generation with structured output and the guardrail layer.
10. Langfuse tracing, Promptfoo evals, Sentry, alerting.
11. Human takeover in the admin panel.

Step 7 is the real milestone. The unanswered-message log it produces is the
specification for the knowledge base in step 8. Do not guess at that content
before the log exists. The existing website's packages (Kedarnath-Badrinath,
Gokarna-Murudeshwar, Sikkim-Darjeeling) are the initial seed data for step 5;
use their real structure rather than placeholder trips.

## What not to do

- No separate vector database. pgvector is sufficient.
- No generic agent framework. This is a bounded domain with a fixed tool set.
- Do not let the LLM call arbitrary tools.
- Do not build booking or payment collection flows. The bot escalates instead.
- Do not scaffold ahead of the current build step.
- Do not use em dashes in code comments, documentation, or user-facing copy.
