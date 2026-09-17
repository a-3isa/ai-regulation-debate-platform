# AI Regulation Debate Platform

Type a topic, pick a number of rounds, and watch four AI personas debate it —
with the Week 4 analytics updating after every round, and the full set of Week 4
deliverables when the debate ends.

This repository is the **product layer** over the four course repositories. It
contains no copy of their code: each service is built from its own repository at
a pinned commit, so nothing here can silently drift from the original work.

```
        browser
           │  SSE: one event per message, opinion and round
           ▼
┌──────────────────────┐        ┌───────────────────────────┐
│  debate service      │───────▶│  analytics service        │
│  (this repo)         │  HTTP  │  Week 4 repo, pinned ref  │
│  drives Week 3 turn  │        │  metrics, report, charts  │
│  by turn             │        └───────────────────────────┘
└──────────┬───────────┘
           │ imports, pinned ref
           ▼
   Week 3 discussion engine ──▶ Week 2 personas/memory ──▶ Week 1 retrieval API
```

| Piece | Source | Role |
| --- | --- | --- |
| `services/debate` | this repo | Runs a debate turn by turn, streams it over SSE |
| `services/analytics` | [Analytics-Intelligence-Layer](https://github.com/YaassminSalahEldin/Analytics-Intelligence-Layer) | All Week 4 metrics, the report, both charts |
| Week 3 engine | [Multi-Agent-Collaboration](https://github.com/a-3isa/Multi-Agent-Collaboration-AI-Regulation-Team_A) | Agent graph, turns, opinion tracking |
| Week 2 personas | vendored inside Week 3 | Persona configs, memory, tools, LLM client |
| Week 1 knowledge base | [week1-ai-regulation-pipeline](https://github.com/a-3isa/week1-ai-regulation-pipeline) | Retrieval over the AI-regulation corpus |
| `frontend` | this repo | The UI |

## What the user sees

1. **Before** — a topic box, a round count (3–8) and a topology choice (ring or mesh).
2. **During** — each agent's message as soon as its turn finishes, a live stance
   readout per agent, evidence pulled from the Week 1 corpus, and four live Week 4
   panels: opinion trajectory, agreement per round, influence ranking, sentiment.
3. **After** — the complete Week 4 deliverables: the automatic Markdown report,
   the opinion-trajectory chart, the interaction graph, and downloads for
   `report.md`, `analytics_result.json` and the raw discussion record.

Every number on screen is computed by the Week 4 engine over HTTP. Nothing is
recomputed in the browser, so the dashboard and the committed reports cannot
disagree.

## Running it locally

```bash
cp .env.example .env          # fill in the keys (see below)
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

Then open <http://localhost:5173>. The debate API is on `:8100` and the
analytics API on `:8000`.

Without `OPENROUTER_API_KEY` the agents fall back to deterministic stub turns —
useful for developing the UI, and the interface says plainly that the LLM is
stubbed so a stubbed run is never mistaken for a real debate.

## Deploying behind Traefik

`docker-compose.yml` carries labels for an existing Traefik instance with the
Docker provider and an ACME resolver:

```
https://$PUBLIC_HOST/            → ui
https://$PUBLIC_HOST/api/        → debate service
https://$PUBLIC_HOST/analytics/  → Week 4 analytics service
https://$PUBLIC_HOST/knowledge/  → Week 1 retrieval (only with the selfhosted-week1 profile)
```

The quickest path on a server that already runs Traefik:

```bash
curl -fsSL https://raw.githubusercontent.com/a-3isa/ai-regulation-debate-platform/main/deploy.sh | bash
# fills in .env from the example on the first run, then re-run it
```

`deploy.sh` clones or updates the checkout, creates the Docker network,
attaches Traefik to it when Traefik runs in a bridge network, builds, and then
verifies `/api/health` and `/analytics/health` over HTTPS. It is idempotent.

```bash
cp .env.example .env    # set PUBLIC_HOST, PUBLIC_ORIGIN, VITE_API_BASE, TRAEFIK_NETWORK, keys
docker compose up -d --build
curl https://$PUBLIC_HOST/api/health
```

`VITE_API_BASE` is compiled into the UI bundle by Vite, so changing it needs an
image rebuild, not just a restart.

## Configuration

| Variable | Purpose |
| --- | --- |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Week 2's LLM provider for agent turns. The model must support tool calling. |
| `AGENT_LLM_STUB` | `1` disables all LLM calls (free, offline, deterministic). |
| `WEEK1_RETRIEVAL_URL`, `WEEK1_API_KEY` | Week 1 knowledge base used for initial opinions and mid-debate evidence. |
| `WEEK1_DATABASE_URL`, `OPENAI_API_KEY` | Only for self-hosting Week 1 (`--profile selfhosted-week1`): the pgvector database holding the embedded corpus, and the embedding model it was built with. |
| `DEBATE_MAX_ROUNDS`, `DEBATE_MAX_CONCURRENT_RUNS` | Bound how much LLM credit one request, or one impatient user, can spend. |
| `SENTIMENT_BACKEND` | `vader` (small, deterministic) or `transformer` (better, ~2.5 GB). |
| `PUBLIC_HOST`, `PUBLIC_ORIGIN`, `VITE_API_BASE` | Routing and CORS. |

## Self-hosting the Week 1 knowledge base

By default the agents query the Week 1 API deployed on Vercel. To run it on
your own server instead:

```bash
# in .env
WEEK1_DATABASE_URL=postgresql://...   # the pgvector database with the corpus
OPENAI_API_KEY=sk-...                 # same embedding model the corpus used
WEEK1_RETRIEVAL_URL=http://knowledge:8200
WEEK1_EMBEDDING_DIMENSIONS=512       # must match the corpus
COMPOSE_PROFILES=selfhosted-week1

docker compose up -d --build
```

The corpus itself is not re-embedded: the service reads whatever database you
point it at. A query must be embedded with the same model **and dimension
count** as the stored vectors, which is why `OPENAI_API_KEY` is still required
even when nothing is being ingested. The deployed corpus is
`text-embedding-3-large` at **512** dimensions - not the 2000 the Week 1 repo's
example config shows. A mismatch fails loudly with
`different vector dimensions 512 and 2000`, so take `EMBEDDING_MODEL` and
`EMBEDDING_DIMENSIONS` from the Week 1 `.env` that built the corpus.

Set `COMPOSE_PROFILES=selfhosted-week1` in `.env` so a plain
`docker compose up` always includes the service.

Verified in production: the same query returns the same top three documents
(AI Act Articles 16, 26 and 14, in that order) from the self-hosted service and
from the Vercel deployment.

## Debate API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/runs` | Start a debate: `{topic, num_rounds, strategy}` → `{run_id}` |
| `GET` | `/runs/{id}/stream` | SSE, replayed from the first event |
| `GET` | `/runs/{id}` | Status, discussion record, latest analytics |
| `GET` | `/runs/{id}/report` | Markdown report + analytics |
| `GET` | `/runs/{id}/charts` | Both Week 4 charts as base64 PNGs |
| `GET` | `/runs/{id}/discussion` | The raw Week 3 record, the shape Week 4's CLI takes |
| `DELETE` | `/runs/{id}` | Ask a running debate to stop after the current turn |
| `GET` | `/health` | Liveness, and whether the analytics service is reachable |

Stream event types: `run_started`, `round_started`, `turn_started`, `message`,
`retrieval`, `opinion`, `round_complete`, `analytics`, `analytics_unavailable`,
`report`, `notice`, `run_complete`, `run_failed`, `stream_end`.

Because `/runs/{id}/stream` replays from event 0, a browser that joins late or
reconnects still renders the entire debate.

## Design notes

**Why not call Week 3's `run_discussion()`?** It compiles a LangGraph and
returns only when the whole debate is over — nothing is observable while it
runs. `services/debate/app/runner.py` reuses the same building blocks
(`run_turn`, `record_round_opinions`, `record_interactions`,
`discussion_converged`) in an explicit loop, preserving Week 3's ordering
exactly, because the Week 4 metrics depend on it.

**Initial opinions are generated for your topic.** Week 3 seeds round 0 from
Week 2's committed opinions, which were written about one fixed topic. For a
topic typed into the box, that baseline answers the wrong question, so opinions
are generated fresh and grounded in Week 1 retrieval. If that is not possible,
the committed seed is used and the record says so in
`config.initial_opinions.source` rather than pretending otherwise.

**Analytics can legitimately be unavailable early.** Week 4 validates a
discussion before computing anything; an early round may not satisfy it. That
arrives as an `analytics_unavailable` event with the reason, and the debate
continues — a metrics gap never kills a run.

**A debate runs in a worker thread.** Week 3's turn logic is synchronous and
network-bound. One thread per active run, capped by
`DEBATE_MAX_CONCURRENT_RUNS`.
