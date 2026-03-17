# Payment Infrastructure

A production-grade distributed payments engine with real-time observability.  
Go backend · TypeScript/React dashboard · Docker · SSE streaming

```
┌──────────────────────────────────────────────────────────────────────┐
│  http://localhost:3000  (React Dashboard)                            │
│                                                                      │
│  ┌─────────────────┐  ┌──────────────────────┐  ┌────────────────┐  │
│  │  Metrics Panel  │  │  Intent Feed (live)  │  │  Travel Rule   │  │
│  │  Rail status    │  │  State machine rows  │  │  Audit Trail   │  │
│  │  Volume chart   │  │  Click for detail    │  │  Live events   │  │
│  └─────────────────┘  └──────────────────────┘  └────────────────┘  │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ SSE  /api/stream
                               │ SSE  /api/stream/intents
                               │ SSE  /api/stream/audit
┌──────────────────────────────▼───────────────────────────────────────┐
│  http://localhost:8080  (Go Engine)                                  │
│                                                                      │
│   Ledger (source of truth)   ←→   Saga Orchestrator                 │
│   Transactional Outbox            Travel Rule Engine                 │
│   Idempotency Registry            Mass Payment Simulator             │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

| Tool | Min version | Install |
|------|------------|---------|
| Docker | 24.x | https://docs.docker.com/get-docker/ |
| Docker Compose | v2 (plugin) | Included with Docker Desktop |

That's it. No Go, Node, or npm needed on your machine.

---

## Quickstart (Docker — recommended)

```bash
# 1. Build and start both services
docker compose up --build

# 2. Open the dashboard
open http://localhost:3000
```

Both services start in parallel. The frontend waits for the backend health check
before serving. First build takes ~60–90 s (downloading Go and Node base images);
subsequent builds are fast thanks to layer caching.

To stop:
```bash
docker compose down
```

To rebuild after code changes:
```bash
docker compose up --build
```

---

## Local Development (without Docker)

### Backend

```bash
# Requires Go 1.21+
cd backend
go mod download
go run main.go
# → Listening on :8080
```

### Frontend

```bash
# Requires Node 20+
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

### Stop everything
```bash
If docker compose is running in your terminal (attached mode):
Ctrl-C        # gracefully stop the containers

docker compose down          # stop containers
docker compose down -v       # stop + delete database volume
```

The Vite dev server proxies `/api/*` → `localhost:8080`, so you don't need to
touch any URLs.

---

## API Reference

All endpoints are served by the Go backend on port `8080`.  
The nginx reverse proxy in Docker exposes them at `/api/*` on port `3000`.

### REST

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check + intent count |
| `GET` | `/intents` | Latest 120 payment intents (JSON array) |
| `GET` | `/audit?intent_id=pi_xxx` | Audit events, optionally filtered |
| `GET` | `/volume-history` | Last-60s volume buckets + rail breakdown |

### Server-Sent Events (SSE)

| Path | Interval | Payload |
|------|----------|---------|
| `/stream` | 400 ms | `SystemMetrics` — aggregated KPIs |
| `/stream/intents` | 600 ms | `PaymentIntent[]` — latest 80 intents |
| `/stream/audit` | 800 ms | `AuditEvent[]` — latest 50 audit events |

SSE streams reconnect automatically on disconnect (client-side, 2.5 s backoff).

---

## Project Structure

```
payment-infra/
│
├── backend/
│   ├── main.go           # Entire Go engine (single file, ~450 LOC)
│   ├── go.mod
│   ├── go.sum
│   └── Dockerfile        # Multi-stage: golang:1.21-alpine → alpine:3.19
│
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx           # Root: wires SSE hooks → layout
│   │   ├── index.css         # CSS variables, global dark theme
│   │   ├── types/index.ts    # Full TypeScript domain types
│   │   ├── hooks/useSSE.ts   # SSE hooks with auto-reconnect
│   │   └── components/
│   │       ├── Topbar.tsx        # Header: throughput, volume, discrepancy
│   │       ├── MetricsPanel.tsx  # Left: stats, sparkline, rail bars
│   │       ├── IntentFeed.tsx    # Center: live feed + drill-down detail
│   │       └── RightPanel.tsx    # Right: travel rule pie, audit trail
│   ├── index.html
│   ├── nginx.conf        # SSE-aware proxy config
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── package.json
│   └── Dockerfile        # Multi-stage: node:20-alpine → nginx:1.25-alpine
│
├── docker-compose.yml    # Wires backend + frontend; health-check dependency
└── README.md
```

---

## Resilience Design

### 1 · Intent / Settlement Separation

Every payment creates two distinct objects with separate lifecycles:

- **`PaymentIntent`** — the immutable "what". Created once, never mutated.
  Holds amount, currency, rail, source, destination, idempotency key.
  Represents the business outcome: `PENDING → SUCCEEDED | FAILED`.

- **`SettlementAttempt`** — the mutable "how". One intent can have up to 3
  attempts (retry logic). Stores the exact provider reference, error code,
  and confirmation block count for every interaction with an external system.

If a provider's callback is delayed, or the queue drops a message, the system
reconstructs "where is this money?" by reading the intent and its attempts
from the ledger — never from the queue.

### 2 · Saga Pattern (Distributed Coordination Without 2PC)

Two-phase commit is impossible across chains and PSPs with different SLAs.
The orchestrator runs a Saga: a sequence of local transactions, each with an
explicit compensating transaction on failure.

```
Intent Created ──▶ Travel Rule Check ──▶ REJECTED ──▶ Compensate (FAILED)
                         │ VERIFIED
                         ▼
                  Attempt 1 ──▶ FAILED ──▶ backoff(100ms)
                         │
                  Attempt 2 ──▶ FAILED ──▶ backoff(200ms)
                         │
                  Attempt 3 ──▶ CONFIRMED ──▶ Ledger: SUCCEEDED
                         │ all failed
                         ▼
                  Compensating Tx ──▶ Unfreeze funds ──▶ FAILED
```

Each saga runs as an independent goroutine. A panic in one saga cannot
cascade to another. The ledger is the source of truth — if the process
crashes mid-saga, on restart it reads the last recorded state and resumes.

### 3 · Transactional Outbox (Durability)

The classic failure mode:

```
UPDATE intents SET state = 'PROCESSING'  ← committed to DB
POST   /provider/send                    ← 💥 process crash
                                           Intent is PROCESSING but
                                           provider was never called
```

The Outbox Pattern solves this by writing the intent to call a provider
**into the same database transaction** as the state change:

```go
// Both writes are atomic — they succeed or fail together
ledger.RecordIntent(intent)               // writes intent row
ledger.outbox = append(outbox, OutboxMsg) // writes outbox row in same lock

// Separate relayer reads outbox → calls provider → marks sent
// Provider idempotency key makes retries safe
```

The queue is never the source of truth. Messages persist in the database
until acknowledged. A queue outage loses zero state.

### 4 · Exactly-Once via Idempotency Keys

Every `PaymentIntent` carries a client-generated `idempotency_key`.
The ledger checks it on every `RecordIntent` call:

```go
if _, ok := l.idempotency[intent.IdempotencyKey]; ok {
    return false  // already processed — do not create a duplicate
}
```

The same key is forwarded to providers, so a retry at the outbox level
returns the original result rather than triggering a double payment.

### 5 · Anti-Corruption Layer (Per-Rail Adapters)

Each rail has its own characteristics, encapsulated in `railCfg`:

| Rail | Success Rate | Latency | Finality | TR Threshold |
|------|-------------|---------|----------|-------------|
| ETHEREUM | 88 % | 600–3000 ms | 12 blocks | $1,000 |
| POLYGON | 91 % | 200–1200 ms | 64 blocks | $1,000 |
| SOLANA | 93 % | 80–600 ms | 31 slots | $1,000 |
| STELLAR | 95 % | 120–500 ms | 1 ledger | $1,000 |
| ACH | 97 % | 300–900 ms | batch | $3,000 |
| CARD | 92 % | 80–350 ms | sync | none |

In production each rail would implement a `Rail` interface. The orchestrator
never knows which chain it's talking to — only the ACL adapter does.

### 6 · Exponential Backoff with Jitter

On provider failure, retries use exponential backoff to avoid thundering-herd:

```
Attempt 1: immediate
Attempt 2: wait 100 ms
Attempt 3: wait 200 ms
Give up  → compensating transaction
```

---

## Travel Rule Compliance

### What Is It?

FATF Recommendation 16 requires VASPs (Virtual Asset Service Providers) to
exchange originator and beneficiary information on transfers. This engine
enforces it as a **hard pre-settlement gate** — no on-chain action is taken
until the compliance check resolves.

### Why Before Settlement?

Blockchain transactions are **irreversible**. If you settle on-chain and
*then* discover the beneficiary is sanctioned, you cannot unwind the transfer.
The architectural consequence is strict ordering:

```
Travel Rule → VERIFIED          (or EXEMPT for amounts below threshold)
      ↓
Settlement begins

Not the other way around.
```

### Jurisdictional Thresholds

| Jurisdiction | Threshold | Notes |
|---|---|---|
| EEA | €0 (all transfers) | AMLD5/6, MiCA |
| UK | £0 (all), enhanced >£1,000 | FCA guidance |
| United States | $3,000 | FinCEN Travel Rule |
| Canada | CA$1,000 | FINTRAC |
| Singapore | SGD 1,500 | MAS PSA |
| UAE | AED 3,675 (~$1,000) | CBUAE |

### State Machine

```
amount >= threshold ──▶ PENDING  (VASP-to-VASP exchange in flight)
                            │
                    ┌───────┴───────┐
                    ▼               ▼
                VERIFIED        REJECTED  ──▶ Compensating Tx
                    │           (sanctions, name mismatch,
                    ▼            VASP non-responsive)
              Settlement
               begins

amount < threshold  ──▶ EXEMPT  (recorded for audit, no exchange needed)
```

### Protocols Simulated

| Protocol | Type | Notes |
|---|---|---|
| TRP v2.1 | REST API | TRISA Travel Rule Protocol |
| OpenVASP | Ethereum-based | Identity via GLEIF LEI registry |
| Shyft Network | Blockchain-anchored | Compliance data on-chain |
| VerifyVASP | API matching | Real-time VASP directory |

### Rejection Scenarios (~6% of eligible transfers)

- Beneficiary name mismatch vs. VASP identity records
- Counterparty VASP on sanctions list
- VASP non-responsive within timeout window
- Beneficiary wallet flagged by screening

On rejection, the saga executes a compensating transaction (funds unfrozen)
and marks the intent `FAILED`. No settlement is attempted.

---

## Observability

### The "Where Is This Money?" Query

Every state transition appends an immutable `AuditEvent` to the ledger.
Given any `intent_id`, you can reconstruct the complete timeline:

```
GET /audit?intent_id=pi_a3f8b2c1

[
  { "event_type": "INTENT_CREATED",    "new_state": "PENDING",   "detail": "rail=ETHEREUM amount=4200.00 USDC" },
  { "event_type": "TRAVEL_RULE_UPDATE","new_state": "PENDING",   "detail": "vasp=Binance VASP protocol=TRP v2.1 jurisdiction=EEA" },
  { "event_type": "TRAVEL_RULE_UPDATE","new_state": "VERIFIED",  "detail": "vasp=Binance VASP protocol=TRP v2.1 jurisdiction=EEA" },
  { "event_type": "ATTEMPT_UPDATED",   "new_state": "INITIATED", "detail": "attempt 1 initiated" },
  { "event_type": "ATTEMPT_UPDATED",   "new_state": "PENDING_EXTERNAL", "detail": "awaiting provider confirmation" },
  { "event_type": "ATTEMPT_UPDATED",   "new_state": "CONFIRMED", "detail": "confirmed ref=0x4a8f... blocks=12" },
  { "event_type": "INTENT_FINALIZED",  "new_state": "SUCCEEDED", "detail": "settled via ETHEREUM" }
]
```

No manual API-crawling. No guesswork. Every dollar is traceable.

### Key Metrics

| Metric | Description | Alert threshold |
|--------|-------------|----------------|
| `throughput_per_sec` | Intents processed per second | — |
| `avg_settlement_ms` | p50 end-to-end latency | > 5 000 ms |
| `outbox_pending` | Undelivered outbox messages | > 20 |
| `discrepancy` | Ledger vs. provider volume delta | > $0.01 |
| `travel_rule.rejected` | TR rejection count | sudden spike |
| `by_rail[*].success_rate` | Per-rail settlement rate | < 80 % |

The `discrepancy` metric is the financial canary: it measures the gap between
your internal settled volume and what providers have confirmed. Any non-zero
value warrants immediate investigation.

---

## Production Checklist

- [ ] Replace in-memory `Ledger` with PostgreSQL (row-level locking for sagas)
- [ ] Persist `OutboxMessage` to DB; run relayer as a separate process
- [ ] Implement real VASP directory lookup (OpenVASP GLEIF LEI registry)
- [ ] Wire discrepancy metric to PagerDuty (threshold: $0.01)
- [ ] Add dead-letter queue for outbox messages exceeding retry limit
- [ ] Encrypt Travel Rule PII at rest (names, addresses, DOB)
- [ ] Add per-source_id rate limiting to prevent payment spam
- [ ] Integrate Chainalysis / Elliptic into Travel Rule ACL for sanctions screening
- [ ] Replace simulator with real webhook receiver for provider callbacks
- [ ] Add distributed tracing (OpenTelemetry) with `intent_id` as root span
