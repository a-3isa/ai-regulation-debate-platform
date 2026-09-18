# AI Regulation Debate Platform

Type a topic, pick a number of rounds, and watch four AI personas debate it —
with the Week 4 analytics updating after every round, and the full set of Week 4
deliverables when the debate ends.

This repository is the **product layer** over the four course repositories. It
contains no copy of their code: every service clones its week from GitHub at a
ref pinned in `.env`, so nothing here can silently drift from the original
work — and `make refs` prints the commit each running container was built from.

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
2. **During** — each agent's message as soon as its turn finishes, the ring
   lighting up to show who is addressing whom, round progress, a live stance
   readout per agent, and an interactive **Positions, as they move** chart that
   redraws as each round lands (tap a member to follow just their line).
   Evidence pulled from the Week 1 corpus appears as it is used, and the
   Analytics page carries the four measured Week 4 panels: opinion trajectory,
   agreement per round, influence ranking with the evidence behind each score,
   and sentiment.
3. **After** — the complete Week 4 deliverables: the automatic Markdown report,
   the opinion-trajectory chart, the interaction graph, and downloads for
   `report.md`, `analytics_result.json` and the raw discussion record.

Every number presented as a **finding** is computed by the Week 4 engine over
HTTP — nothing is recomputed in the browser, so the dashboard and the committed
reports cannot disagree. The one exception is deliberate and labelled: the live
chart on the Debate page plots the `stance_score` values straight off the event
stream, because the analytics payload arrives a beat after each round and a
chart that jumps is worse than one that moves. Those are the same stances Week 4
reads; the Analytics and Report pages remain the place measured numbers live.

### One member, one colour

A member's colour is derived from its **id**, not from its position in whatever
list a chart happens to be drawing — so the EU regulator is the same blue in the
ring, the transcript, the trajectory, the influence ranking (which is sorted by
score, and therefore in a different order), the members page, and the PNGs
embedded in the committed report. `frontend/src/agentColors.js` and Week 4's
`src/visualization/palette.py` implement the same mapping over the same palette,
and Week 4's test suite fails if the two lists drift apart.

## Running it locally

```bash
cp .env.example .env            # fill in the keys (see below)
export GIT_TOKEN=ghp_...        # the four week repos are private
make up-local                   # or ./scripts/stack.sh up-local
                                # or .\scripts\stack.ps1 up-local   (Windows)
```

Then open <http://localhost:5173>. The debate API is on `:8100`, the analytics
API on `:8000`, the Week 1 retrieval service on `:8200`, and Postgres on
`:5432`.

Without `make`, `scripts/stack.sh` and `scripts/stack.ps1` take the same verbs
(`up`, `up-local`, `build`, `pull`, `down`, `logs`, `ps`, `refs`, `health`).
The plain compose command still works too:

```bash
DOCKER_BUILDKIT=1 docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

### One command, every week

`make up` starts the whole course:

| Service | Week | Where the code comes from |
| --- | --- | --- |
| `knowledge` | 1 | cloned by `services/knowledge/Dockerfile` at `WEEK1_REF` |
| (inside `debate`) | 2 | vendored in Week 3 at `src/vendor/week2`; `WEEK2_OVERLAY=1` to clone it separately |
| `debate` | 3 | cloned by `services/debate/Dockerfile` at `WEEK3_REF` |
| `analytics` | 4 | cloned by `services/analytics/Dockerfile` at `WEEK4_REF` |
| `db` | — | `pgvector/pgvector:pg16`, the corpus database Week 1 reads |
| `ui` | — | this repo |

Every repo URL, branch and ref is in one block at the top of `.env.example`.
Re-clone them all, ignoring the Docker cache, with `make pull`.

**The week repositories are private**, so the Docker daemon needs a credential
to read them. Export `GIT_TOKEN` (a token with `repo:read`) and compose passes
it to the builds as a BuildKit **secret** — mounted only for the `RUN` that
clones, never stored in a layer and not visible in `docker history`. Without a
token the clone is anonymous, which is what you want once the repositories are
public; nothing else changes. Building with the legacy builder fails, because
`--mount=type=secret` is a BuildKit feature — the Makefile and both scripts set
`DOCKER_BUILDKIT=1` for you.

Check what actually got built:

```bash
make refs
# week3 93af9b3c... feat: ...
# week2: vendored inside week3 (WEEK2_OVERLAY=0)
# week4 251a6be... feat(api): ...
# week1 d8e6637e... ...
```

Without `OPENROUTER_API_KEY` the agents fall back to deterministic stub turns —
useful for developing the UI, and the interface says plainly that the LLM is
stubbed so a stubbed run is never mistaken for a real debate.

## Latency

A debate is one or two model calls per agent per round, in series, so the
model's speed *is* the app's speed. Four things were done about it, in order of
how much they were worth:

1. **A faster model.** `OPENROUTER_MODEL` defaults to
   `google/gemini-2.5-flash`. The previous default,
   `meta-llama/llama-3.3-70b-instruct`, writes well and slowly: a 70B dense
   model generating 700 tokens a turn is the difference between a demo that
   feels live and one that feels broken. `.env.example` lists the tool-capable
   alternatives, including the old default if you preferred it.
2. **Round 0 in parallel.** Opening positions are independent — each agent reads
   the same Week 1 evidence and talks to nobody — so they are generated
   concurrently (`DEBATE_SEED_CONCURRENCY`, default 4). On a four-member council
   that turns four sequential model-plus-retrieval waits into one. The results
   are recorded in the fixed agent order afterwards, so the saved record is
   identical to what the sequential version produced.
3. **Analytics off the debate thread.** `on_round` used to POST the whole
   discussion to the Week 4 service *and wait* — up to a 120-second timeout —
   before the next round could start, for a result the debate never reads. It
   now runs on a small background pool and reaches the browser over the stream
   whenever it is ready.
4. **Coalesced writes.** Every persisted event rewrote the entire run record,
   including its whole event log, on the debate thread — O(events²) of JSON,
   growing as the debate went on. Writes are now coalesced
   (`DEBATE_SAVE_INTERVAL`, default 2 s), with terminal events still written
   synchronously so nothing is lost. Tested in
   `services/debate/tests/test_saving.py`.

Optional, and off by default: `DEBATE_PARALLEL_TURNS=1` runs a round's turns
concurrently. This is **not** a free speed-up — it changes the debate.
Sequentially an agent reads the previous round in full *plus this round so far*,
so the second speaker can answer the first; in parallel everyone sees only the
previous round. Roughly N times faster, and a shallower conversation.
`config.parallel_turns` on every discussion records which one produced it.

Measuring it: every turn emits a `turn_complete` event with its duration, every
round a `round_complete` with its own, and each saved discussion carries
`config.timings` (`seed_seconds`, per-round seconds, `total_seconds`). So a
change here is a measurement rather than an impression.

## Deploying behind Traefik

`docker-compose.yml` carries labels for an existing Traefik instance with the
Docker provider and an ACME resolver:

```
https://$PUBLIC_HOST/            → ui
https://$PUBLIC_HOST/api/        → debate service
https://$PUBLIC_HOST/analytics/  → Week 4 analytics service
https://$PUBLIC_HOST/knowledge/  → Week 1 retrieval service
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
| `GIT_TOKEN` | Read access for cloning the four private week repositories. Passed to the builds as a BuildKit secret, never into a layer. |
| `WEEK1_…`, `WEEK2_…`, `WEEK3_…`, `WEEK4_…` | Repo, branch and ref for each week. One block, at the top of `.env.example`. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Week 2's LLM provider for agent turns. The model must support tool calling, and its speed is the app's speed — see **Latency**. |
| `AGENT_LLM_STUB` | `1` disables all LLM calls (free, offline, deterministic). |
| `DEBATE_SEED_CONCURRENCY` | How many opening positions to generate at once. |
| `DEBATE_PARALLEL_TURNS` | `1` runs a round's turns concurrently. Faster, and a different debate — see **Latency**. |
| `DEBATE_SAVE_INTERVAL` | Shortest gap between two writes of a run's record, in seconds. |
| `WEEK1_RETRIEVAL_URL`, `WEEK1_API_KEY` | Week 1 knowledge base used for initial opinions and mid-debate evidence. |
| `WEEK1_DATABASE_URL`, `OPENAI_API_KEY` | The pgvector database holding the embedded corpus, and the embedding model it was built with. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Credentials for the bundled `db` service. Change them for anything public. |
| `DEBATE_MAX_ROUNDS`, `DEBATE_MAX_CONCURRENT_RUNS` | Bound how much LLM credit one request, or one impatient user, can spend. |
| `SENTIMENT_BACKEND` | `vader` (small, deterministic) or `transformer` (better, ~2.5 GB). |
| `PUBLIC_HOST`, `PUBLIC_ORIGIN`, `VITE_API_BASE` | Routing and CORS. |

## Serving Week 1 from this stack

The `knowledge` service is part of the default stack, so `make up` really does
start every week. What the agents *call*, though, is a separate decision:
`WEEK1_RETRIEVAL_URL` defaults to the hosted deployment. To serve retrieval
from here instead:

```bash
# in .env
WEEK1_RETRIEVAL_URL=http://knowledge:8200
WEEK1_DATABASE_URL=postgresql://week1:week1@db:5432/week1  # the bundled db
OPENAI_API_KEY=sk-...                 # same embedding model the corpus used
WEEK1_EMBEDDING_DIMENSIONS=512        # must match the corpus

make up
```

The bundled `db` service is `pgvector/pgvector:pg16` and creates the `vector`
extension on a fresh volume. It does **not** contain the corpus: embedding the
documents is Week 1's own pipeline, and reimplementing its schema here would be
a second definition of it, free to drift. Until the corpus is loaded, searches
answer with an error naming what is missing rather than returning nothing and
looking like a result.

The corpus itself is not re-embedded: the service reads whatever database you
point it at. A query must be embedded with the same model **and dimension
count** as the stored vectors, which is why `OPENAI_API_KEY` is still required
even when nothing is being ingested. The deployed corpus is
`text-embedding-3-large` at **512** dimensions - not the 2000 the Week 1 repo's
example config shows. A mismatch fails loudly with
`different vector dimensions 512 and 2000`, so take `EMBEDDING_MODEL` and
`EMBEDDING_DIMENSIONS` from the Week 1 `.env` that built the corpus.

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

Stream event types: `run_started`, `round_started`, `turn_started`,
`turn_complete`, `message`, `retrieval`, `opinion`, `round_complete`,
`analytics`, `analytics_unavailable`, `report`, `notice`, `run_complete`,
`run_failed`, `stream_end`.

`turn_complete` and `round_complete` carry a `seconds` field, which is how the
latency work above is measured rather than asserted.

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

**Influence is a magnitude, and the direction is a separate number.** The
Week 4 score answers "how much did listeners move in the rounds they read this
member" — deliberately not *which way*. A revision that folded direction into
the score by negating it made the primary score go negative, which inverted the
report's highest-influencer ranking and drew the most polarizing member as the
smallest node in the interaction graph. Direction now lives beside the score as
`mean_alignment`, and the dashboard shows both: the bar is the magnitude, the
last column of the table says whether listeners moved towards that member or
away from them.

**Appearance follows the system, and can be overridden.** Light, dark, or
follow-the-OS, remembered per browser. The charts read their axis, grid and
tooltip colours out of the same CSS custom properties as everything else, so a
theme switch restyles them too, and the inline script in `index.html` paints the
saved theme before the first frame so a dark-mode visitor gets no white flash.
