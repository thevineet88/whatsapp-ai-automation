# Samyati WhatsApp Assistant

A WhatsApp bot that answers traveller questions for **Samyati Holidays**, a group tour operator in Mumbai and Pune, and hands the conversation to a human the moment it should not answer.

It is built around one idea: **the bot is allowed to be unhelpful, but never allowed to be wrong.** Prices, dates and seats come from the database, never from the AI. Health and booking questions go to a person, always. If anything breaks, the traveller still gets a reply.

```
Traveller:  kedarnath kab hai aur kitne ka hai?
Bot:        Kedarnath-Badrinath Yatra, upcoming batches:
            ...dates and seats, straight from the batches table...
            Starting from Rs XX,XXX per person (from the pricing table)
```

---

## Contents

1. [What it does, in 30 seconds](#what-it-does-in-30-seconds)
2. [Follow one message through the system](#follow-one-message-through-the-system)
3. [The three ways the bot answers](#the-three-ways-the-bot-answers)
4. [When the bot hands off to a human](#when-the-bot-hands-off-to-a-human)
5. [The rules it never breaks, and where each one lives](#the-rules-it-never-breaks-and-where-each-one-lives)
6. [Bugs we hit in real use, and how the code handles them now](#bugs-we-hit-in-real-use-and-how-the-code-handles-them-now)
7. [Data model](#data-model)
8. [Run it locally](#run-it-locally)
9. [Deploy](#deploy)
10. [The admin panel](#the-admin-panel)
11. [Where things live](#where-things-live)
12. [Status: built, partial, not yet](#status-built-partial-not-yet)
13. [Known issues](#known-issues)

---

## What it does, in 30 seconds

Samyati gets the same questions on one WhatsApp number all day: *when is the next batch, how much, what is included, where does the train leave from, can I cancel.* Three people (Rohit, Shrutika, Tejashree) answer them by hand.

This system takes the repetitive first-touch questions off them:

| Traveller asks | Bot does |
|---|---|
| "Next Sikkim batch?" | Reads upcoming batches and seats from Postgres |
| "Kitne ka hai?" | Reads the price from the pricing tables |
| "Is food included?" | Sends the stored inclusions and exclusions list |
| "Will it be cold in October?" | Searches the knowledge base, answers with cited sources |
| "Can my 70 year old father do this trek?" | **Does not answer.** Escalates to the team |
| "I want to book" | Collects passenger details, then hands a summary to the team |
| Sends a voice note | Politely asks them to type |

It never takes a booking or a payment. It never judges anyone's fitness.

---

## Follow one message through the system

This is the whole system. Everything else in the repo supports one of these steps.

```mermaid
flowchart TD
    A[Traveller sends a WhatsApp message] --> B["Webhook  /api/webhook/whatsapp<br/>verify signature, dedupe, enqueue, return 200"]
    B --> C[(Redis queue: BullMQ)]
    C --> D["Worker  src/worker<br/>lock this traveller, save the message"]
    D --> E{Admin has taken over?}
    E -- yes --> Z[Stay silent. Admin replies from the panel]
    E -- no --> F{Keyword safety check<br/>health, booking, complaint, human}
    F -- hit --> ESC[Escalate to the team]
    F -- clear --> G["Understanding pass (DeepSeek)<br/>intent, which trip, safety flags"]
    G --> H{What kind of question?}
    H -- price, batches, itinerary... --> T["Tool layer<br/>read straight from Postgres"]
    H -- booking / custom trip --> COL["Collector<br/>ask for details, then hand off"]
    H -- open question --> R["Knowledge base (RAG)<br/>retrieve, gate, generate, check citations"]
    H -- unclear trip --> CL[Ask which trip]
    T --> S[Send reply on WhatsApp]
    R -- passes every check --> S
    R -- fails any check --> ESC
    COL --> ESC
    ESC --> S2[Send a holding reply so the traveller is never ignored]
    S --> TR[(Save a trace row for debugging)]
    S2 --> TR
```

### Step by step, in plain language

**1. The webhook receives it and gets out of the way.**
`src/app/api/webhook/whatsapp/route.ts`
Meta calls this URL. It checks the `X-Hub-Signature-256` header so nobody can fake a message, looks up which business the phone number belongs to, and puts the message on a queue. It does no AI work at all. Meta retries if it does not get a fast `200`, so this route stays tiny.

**2. Duplicates are stopped twice.**
Meta sometimes sends the same message more than once. A Redis key (`wa:dedupe:<message id>`) catches most repeats, and a unique row in the `processed_webhooks` table catches anything that slips past. The queue job id is also the message id. One message, one reply.

**3. The worker picks it up and locks the traveller.**
`src/worker/handlers/answerMessage.ts`
The worker processes 5 messages at once. If the same person sends two messages a second apart, they would race each other. A Redis lock per phone number (`wa:lock:<tenant>:<phone>`) makes their messages run one at a time, while different travellers still run in parallel.

**4. Non-text messages get a friendly redirect.**
Voice notes, images, stickers, locations: the bot replies "please type your question" instead of wasting an AI call on something it cannot read.

**5. If a human has taken over, the bot goes quiet.**
The message is still saved so the admin sees it. The bot sends nothing.

**6. The keyword safety check runs first.**
`src/lib/router/intent.ts`
A plain list of words ("knee", "asthma", "pregnan", "refund", "talk to rohit", ...). No AI. If it matches, that decision is final and the AI cannot overrule it.

**7. The understanding pass reads the message.**
`src/lib/llm/understanding.ts`
One DeepSeek call, with the last 8 turns of the conversation, returns structured JSON: the intent, which trip the traveller means, and safety flags. This is what lets "and the price?" work after "tell me about Sikkim". The AI can *add* caution here but can never *remove* the keyword check's decision.

**8. The router decides how to answer.** (next section)
`src/lib/router/route.ts`

**9. Durable state is written before sending.**
Escalations and conversation state go to the database *first*. Then the WhatsApp send. If the send fails, the team still has a record. The outgoing message is saved only after WhatsApp confirms it, so the transcript never shows a reply the traveller did not get.

**10. A trace row is saved for every message.**
`src/lib/observability/persistTrace.ts`
Intent, tool calls and their outputs, which knowledge chunks were retrieved and their scores, model name, token counts, latency, config version. When the bot says something odd, this row is how you find out why.

---

## The three ways the bot answers

### 1. The tool layer: facts from the database (no AI)

`src/lib/tools/` and `runToolIntent()` in `src/lib/router/route.ts`

For anything with a number or a date in it, the AI only picks *which* tool to run and *which* trip. The values come from SQL.

| Intent | What it reads |
|---|---|
| `batches` | Upcoming dated departures, seats left, last booking date |
| `price` | Starting price of the first batch that is not full |
| `installments` | The stored installment table |
| `cancellation_policy` | The stored cancellation table |
| `itinerary`, `inclusions_exclusions`, `departure_point`, `duration`, `package_overview` | Fields on the package row |

A full batch is never offered as available. If a message asks two things ("when is it and how much?"), both are answered in one reply.

### 2. Fixed replies

`src/lib/router/replies.ts`
Greetings, "how do I book", the list of trips, "we don't run that destination". Written once, never generated.

### 3. The knowledge base: open questions, with four checks

`src/lib/llm/generateAnswer.ts`

For questions like "is it cold in October" or "do I need a permit for Nathula":

1. **Retrieve.** `src/lib/rag/retrieval.ts` runs two searches over `knowledge_chunks`: meaning-based (pgvector, Jina embeddings, 768 dims) and exact-word (Postgres full-text). Short WhatsApp messages break each one alone: vectors miss place names, full-text misses paraphrases. The two ranked lists are merged with Reciprocal Rank Fusion (`1 / (60 + rank)`). If the traveller is already talking about a trip, only that trip's chunks and general chunks are searched.
2. **Gate.** `src/lib/guardrails/retrievalGate.ts`. If the best match scores below `0.015`, the AI is **not called at all**. Weak evidence means hand off, not guess.
3. **Generate.** DeepSeek at temperature 0.2 returns JSON: the answer text plus the IDs of the chunks it used. Checked against a Zod schema.
4. **Check citations.** `src/lib/guardrails/citationValidation.ts`. Every cited ID must be a chunk that was actually retrieved. Zero citations, or one invented ID, and the answer is thrown away.

Fail any of the four and the traveller gets a holding reply while the team is notified. There is no "best effort" answer.

### Bonus: the collector (booking and custom trips)

`src/lib/router/collector.ts`

When someone wants to book or asks for a custom trip, the bot sends **one** message listing everything the team needs (passenger count, names and ages, email, room sharing, train class, and so on). The traveller answers in any order, in any words. A DeepSeek extractor maps their reply to fields and keeps the raw text so nothing is lost. Once at least half the fields are filled, it hands the team a structured summary. It never confirms a booking itself.

---

## When the bot hands off to a human

Every escalation is **hard** or **soft**. This distinction matters more than anything else in `src/lib/guardrails/escalationPolicy.ts`.

**Hard: a person needs to own this.** The conversation moves to `awaiting_human`. The bot still answers safe factual questions in the meantime.

- Fitness, health, age or medical suitability
- Booking, payment or refund
- Complaint or safety concern
- Traveller asks for a human
- Booking or custom trip details collected

**Soft: the system had a problem, not the traveller.** The team is told, but the bot keeps serving the traveller normally.

- Knowledge base match too weak, citation invalid, AI error, tool error
- No upcoming batches or no payment schedule stored
- Asked "which trip?" 3 times without an answer

Hard escalations are deduplicated: three messages about the same knee are one item for the team, not three. Soft ones are always recorded, because collapsing them hid a real outage once (see below).

---

## The rules it never breaks, and where each one lives

These come from `CLAUDE.md`. This table is the useful part: it shows the exact code that enforces each promise, so you can check it rather than trust it.

| # | Rule | Enforced in |
|---|---|---|
| 1 | Prices, dates and seats never come from the AI | `runToolIntent()` in `route.ts`: every value is a DB read |
| 2 | No knowledge answer without a real source | `citationValidation.ts` |
| 3 | The bot never judges fitness or health | Keyword list in `intent.ts` + `safetyFlags` in `escalationPolicy.ts` |
| 4 | The bot never takes a booking or payment | Collector hands off, never confirms |
| 5 | Every table has `tenant_id`, every query filters on it | `src/lib/db/schema.ts`, `src/lib/db/scoped.ts` |
| 6 | Webhook replies `200` fast, does no AI work | `route.ts` under `api/webhook` |
| 7 | Every message processed exactly once | Redis `NX` key + `processed_webhooks` + `jobId` + unique `meta_message_id` |
| 8 | The traveller is never left in silence | Holding reply on every failure path; send failures recorded as escalations |
| 9 | Phone numbers masked in logs | `maskPhone()` shows only the last 4 digits |
| 10 | The AI can add caution, never remove it | `resolveEscalation()`: keyword verdict is checked first and is final |
| 11 | A trip ID the AI returns is used only if it exists | `validatePackageId()`, same discipline as citations |

---

## Bugs we hit in real use, and how the code handles them now

Most READMEs skip this. It is the most valuable part of the repo, because each fix encodes something learned from real traveller messages. The reasoning is also written as comments next to the code.

**The bot talked itself into silence.**
The AI saw its own "our team will get back to you" replies in the history, concluded a human had taken over, and flagged the next ordinary question as needing a human too, which produced another handoff reply. The traveller stopped getting answers.
*Fix:* the bot's handoff replies are removed from the history the AI sees. (`answerMessage.ts`, history filter)

**A failed send left no trace.**
A bad WhatsApp token made every send fail, and the error was thrown before the escalation was saved. The team never knew the bot had gone mute.
*Fix:* all database writes happen before the send, and a failed send is itself recorded as a hard `whatsapp_send_failed` escalation. The worker also checks the token against every configured number at startup and logs plainly if it is invalid. (`answerMessage.ts`, `worker/index.ts`)

**The AI's "needs a human" flag flipped randomly.**
The same message came back `needsHuman: true` on one run and `false` on the next, so a simple price question sometimes got a holding reply.
*Fix:* that flag can no longer block questions the database can answer on its own (price, batches, itinerary and so on). Real safety flags are unaffected. (`escalationPolicy.ts`, `SELF_SERVICEABLE_INTENTS`)

**"How much is the Nashik trip?" got Sikkim's price.**
Samyati does not run Nashik. The bot carried over the last trip discussed and quoted a price for a trip nobody asked about.
*Fix:* if the traveller names a place that is not in the catalogue, the bot says "we don't run that, here's what we do" instead of reusing the old trip. (`route.ts`, `namedUnrecognizedPlace`)

**"Kedarnath trip" started a booking form.**
The AI over-read a bare trip name as booking intent.
*Fix:* a booking is only trusted if the message has a real booking verb ("book", "reserve", "lock my seat") or a trip is already being discussed. (`route.ts`, `hasBookingVerb`)

**"Apsarkonda Waterfall?" got a handoff.**
A bare place name from the itinerary looked like an unanswerable question.
*Fix:* if a place in the current trip's itinerary is mentioned without question words, the bot answers with that itinerary. "Do I need a permit for Nathula?" still goes to the knowledge base. (`route.ts`, `extractItineraryPlaces`)

**"Train ka naam?" went nowhere.**
*Fix:* transport questions (including Hinglish ones) are routed to the trip's travel details. (`route.ts`, `transportKeywordsHit`)

**Answers without context.**
"Tell me about the hotels", two messages after "Kerala trip?", read as if out of nowhere.
*Fix:* when the trip was carried over from earlier, the reply starts with "Since you mentioned Kerala Trip earlier, here's the info". (`withAnchorContext`)

**Soft escalations hid an outage.**
They used to be deduplicated like hard ones, so a repeating failure showed up as one row, and a live outage had to be reproduced by hand.
*Fix:* soft escalations are always recorded.

**Rate limits during ingestion.**
Jina's free tier allows 100 requests per minute and the embedding call fired every batch at once.
*Fix:* parallel calls capped at 2. (`embedder.ts`)

---

## Data model

The model mirrors Samyati's own package pages rather than inventing a structure.

```
tenants (Samyati Holidays)
 ├── whatsapp_accounts      phone_number_id -> tenant
 ├── tenant_configs         escalation contacts, holding reply, admin password (versioned)
 ├── packages               the product: itinerary, inclusions, advisory, category, duration
 │    ├── batches           a dated departure: seats, starting price, last booking date
 │    │    └── batch_price_variants   per-occupancy prices
 │    ├── payment_installments        the installment table
 │    ├── cancellation_rules          the cancellation table
 │    └── package_aliases             "kedarnath", "kedar", "badrinath" -> one package
 ├── knowledge_chunks       text + 768-dim embedding, package_id or null for general
 ├── conversations          status, anchored trip, collector phase, clarification count
 │    ├── messages          inbound and outbound, cited chunk IDs, escalation reason
 │    ├── escalations       reason, hard/soft, pending/resolved, captured details
 │    └── message_traces    everything needed to debug one reply
 └── processed_webhooks     one row per Meta message id
```

Three domain choices worth knowing:

- **A package is not a hotel.** Availability means seats on a batch, not nights on a calendar.
- **Money is stored in integer paise**, never floats. Batch dates are `date` in IST.
- **Single tenant, multi-tenant schema.** Every table has `tenant_id` now, because adding it later means migrating live traveller data. Row Level Security and multi-org login are deliberately *not* built, because those are cheap to add later. Build the expensive-to-defer thing, defer the cheap-to-add thing.

Seed data covers 8 real Samyati packages: Kedarnath-Badrinath, Gokarna-Murudeshwar, Sikkim-Darjeeling, Kerala, Rameshwaram, Nainital-Mussoorie, Ayodhya-Kashi-Prayagraj, Ujjain-Indore-Omkareshwar.

---

## Run it locally

**You need:** Node 20, Docker, a DeepSeek API key, a Jina API key. For real WhatsApp traffic you also need a Meta app with the WhatsApp Cloud API and a tunnel (ngrok or cloudflared).

### Step 1: start Postgres (with pgvector) and Redis

```bash
docker compose up -d
```

### Step 2: create `.env`

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/waa
REDIS_URL=redis://localhost:6379

DEEPSEEK_API_KEY=...        # understanding, answers, collector
JINA_API_KEY=...            # embeddings

WHATSAPP_ACCESS_TOKEN=...          # used by the worker to send replies
WHATSAPP_APP_SECRET=...            # used by the webhook to verify signatures
WHATSAPP_WEBHOOK_VERIFY_TOKEN=...  # any string; paste the same one into Meta

SENTRY_DSN=                 # optional
```

The WhatsApp phone number ID is **not** an env var. It lives in the `whatsapp_accounts` table, which is how a message finds its tenant.

### Step 3: set up the database

```bash
npm install
npm run db:migrate          # create tables
npm run db:seed             # Samyati tenant + 8 packages + batches + pricing
npm run db:seed:aliases     # trip nicknames
npm run db:ingest           # chunk and embed the knowledge base (calls Jina)
```

### Step 4: run both processes

```bash
npm run dev       # terminal 1: web (webhook + admin panel) on :3000
npm run worker    # terminal 2: the worker that actually answers
```

Both must run. The web process only queues messages; nothing replies without the worker.

### Step 5: connect WhatsApp

Point a tunnel at `localhost:3000`, then in the Meta app set the webhook URL to `https://<tunnel>/api/webhook/whatsapp` with your verify token, and subscribe to `messages`. Make sure a `whatsapp_accounts` row has your `phone_number_id`.

### Checks

```bash
npm run lint        # Biome
npm run typecheck
npm test            # Vitest. Integration tests start real Postgres and Redis via Testcontainers
```

121 test cases, including a forged-signature test and a duplicate-delivery test for the webhook, and a test that a full batch is never offered.

---

## Deploy

`render.yaml` defines two services from this one repo:

| Service | Runs | Why separate |
|---|---|---|
| `whatsapp-bot-web` | `npm run start` | Webhook + admin panel. Health check at `/api/health` |
| `whatsapp-bot-worker` | `npm run worker:prod` | Long-running queue consumer |

Serverless platforms (like Vercel) don't fit: the webhook needs a warm server and the worker never stops. You need managed Postgres **with pgvector** and a Redis instance. Before deploying, read [Known issues](#known-issues).

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests and build on every push to `main` and on every pull request. `integration.yml` runs the container-backed tests.

---

## The admin panel

Served by the web process. Single shared password stored in the config row.

- **Conversations:** filter by status, read full threads, **take over** a conversation (the bot goes silent), reply manually, and **return it to the bot**.
- **Packages:** create and edit packages, their batches, and their payment schedule.
- **Config:** escalation contacts, holding reply message, admin password. Each save is a new version, and every trace records which version answered.

---

## Where things live

```
src/
  app/
    api/webhook/whatsapp/   receive, verify, dedupe, enqueue
    api/health/             for the host's health check
    (admin)/                conversations, packages, config
  worker/
    index.ts                queue consumer, startup token check, graceful shutdown
    handlers/answerMessage.ts   the per-message pipeline
  lib/
    router/       route.ts (decides how to answer), intent.ts (keywords),
                  collector.ts, packageMatch.ts, catalogue.ts, replies.ts
    llm/          understanding, answer generation, collector extraction, prompts
    rag/          chunking, embedding, hybrid retrieval, ingestion
    guardrails/   retrieval gate, citation check, escalation policy
    tools/        packages and pricing: pure database reads
    db/           Drizzle schema, migrations, seed, tenant-scoped helpers
    whatsapp/     Cloud API client, signature verification
    observability/  trace persistence, Sentry
    core/         Zod schemas and types. Imports nothing else
drizzle/          13 SQL migrations
tests/            Vitest unit + Testcontainers integration tests
CLAUDE.md         the design spec and build order this code follows
```

---

## Status: built, partial, not yet

Following the build order in `CLAUDE.md`:

| Step | What | Status |
|---|---|---|
| 1-3 | Repo, schema, webhook, worker, WhatsApp client | Done |
| 4 | Versioned config + admin page | Done |
| 5-6 | Packages, batches, pricing, payment schedules, tool layer | Done |
| 7 | Intent router + fixed replies | Done, plus an AI understanding pass on top |
| 8 | Knowledge base ingestion + hybrid retrieval | Done. No reranker yet (RRF only) |
| 9 | AI answers + guardrails | Done |
| 10 | Tracing, evals, alerting | **Partial.** Postgres traces and Sentry work. Langfuse client exists but is never called. No Promptfoo evals. Escalations are logged, not pushed to the team |
| 11 | Human takeover | Done. Playwright tests not yet added |

Where the code differs from `CLAUDE.md` (the code is the truth):

- Deploys on **Render**, not Railway.
- Uses **DeepSeek** via the OpenAI SDK with JSON mode (DeepSeek has no strict schema output), validated by Zod afterwards, rather than the AI SDK's `generateObject`.
- Embeddings are **Jina** `jina-embeddings-v2-base-en`.

---

## Known issues

Found while writing this README. Worth fixing before the next deploy.

1. **The admin cookie contains the password.** `cookies.ts` says it stores a hash, but it stores the password in base64, which anyone can decode. The password is also stored in plain text in the config row. Fix: store a bcrypt or scrypt hash in config, and put a random session token (or an HMAC signed with a server secret) in the cookie.
2. **The DeepSeek calls have no timeout.** A hung request blocks a worker slot and holds the traveller's lock. Pass an `AbortSignal.timeout(...)` the way `embedder.ts` does.
3. **Keyword matching is substring-based.** `"kid"` matches "kidding", and `"can my"` matches "can my friend join too?", both causing hard escalations. Word boundaries would fix most of this.
4. **The webhook opens new DB and Redis connections on every request.** Fine at today's volume; reuse module-level clients before a season launch spike.
5. **Admin replies ignore WhatsApp's 24-hour window.** Replying more than 24h after the traveller's last message needs an approved template, which is not built yet.
