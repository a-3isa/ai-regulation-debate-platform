# AI Regulation Debate Platform

Type a topic, pick a number of rounds, and watch four AI personas debate it —
with the Week 4 analytics updating after every round, and the full set of Week 4
deliverables when the debate ends.

**Live: <https://srv1982020.hstgr.cloud>** — nothing to install, no key needed
to look around. Check it is up before you open it:

```bash
curl https://srv1982020.hstgr.cloud/api/health
# {"status":"ok","analytics_reachable":true,"active_runs":0,...}
```

A debate takes a few minutes of real model calls, so the fastest way to see the
whole product is to open a finished one from the history table rather than
starting a new one and waiting.

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

### From nothing, step by step

The machine needs Docker with Compose v2 - `docker compose version` has to
answer - and a few GB of free disk for the four images. Node 18 or newer is
needed only to run the frontend outside its container; nothing else is installed
on the host, because every service builds into an image of its own.

1. **Clone the repository.**

   ```bash
   git clone https://github.com/a-3isa/ai-regulation-debate-platform.git
   cd ai-regulation-debate-platform
   ```

   `github.com/Abdo0213/week05_production_app` is the same tree at the same
   commit, and is the repository the server deploys from. Pushing to only one of
   the two is how they stop being the same.

2. **Create `.env` from the example.**

   ```bash
   cp .env.example .env
   ```

   For a local run, three settings are load-bearing: `OPENROUTER_API_KEY`
   (empty means deterministic stub turns, and the UI says so), and
   `WEEK1_RETRIEVAL_URL` with `WEEK1_API_KEY`, which are the retrieval used for
   opening positions and mid-debate evidence. `PUBLIC_HOST`, `PUBLIC_ORIGIN`
   and `VITE_API_BASE` belong to the Traefik path: `docker-compose.local.yml`
   publishes ports directly and builds the UI against `http://localhost:8100`
   whatever `.env` says.

3. **Export a GitHub token.** The four week repositories are private, so the
   builds clone them with a token passed to BuildKit as a secret:

   ```bash
   export GIT_TOKEN=ghp_...          # PowerShell: $env:GIT_TOKEN = "ghp_..."
   ```

   Without read access to those repositories the images cannot build at all. If
   you have the week sources on disk rather than access to their remotes, build
   from them with the `Dockerfile.local` variants instead - see **Deploying to a
   host that holds no GitHub token**.

4. **Build and start everything.**

   ```bash
   make up-local                     # ./scripts/stack.sh up-local
                                     # .\scripts\stack.ps1 up-local   (Windows)
   ```

   The first run clones four repositories and installs their dependencies, so it
   takes a while; later runs reuse the cache.

5. **Check what came up.**

   ```bash
   make ps
   make health
   curl http://localhost:8100/health
   ```

   Every service except the UI declares a `HEALTHCHECK`, so `debate`,
   `analytics` and `knowledge` should read `healthy` rather than only `up`, and
   `/health` should report `analytics_reachable: true`. `make refs` prints the
   commit each container was actually built from.

6. **Open <http://localhost:5173>**, type a topic, pick a round count and a
   topology, and start a debate. A real debate is one model call per agent per
   round, so it takes minutes - opening a finished one from the history table is
   the faster way to see the whole product. See **Latency**.

7. **Stop it.** `make down` stops the stack and keeps every volume, so debates,
   edited members and the corpus survive. `make clean` is the one that deletes
   them, and it asks first.

The tests need none of the above: `make test` runs against a stub of the Week 3
tree, with no containers, no token and no network.

Without `make`, `scripts/stack.sh` and `scripts/stack.ps1` take the same verbs
(`up`, `up-local`, `build`, `pull`, `down`, `logs`, `ps`, `refs`, `health`).
The plain compose command still works too:

```bash
DOCKER_BUILDKIT=1 docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

### Running one piece at a time

`make up-local` is the supported path, and the table below is what a reviewer
needs when only one piece is being worked on.

| Piece | Command |
| --- | --- |
| Everything | `make up-local`, then <http://localhost:5173> |
| The frontend, against a running backend | `cd frontend && npm install && VITE_API_BASE=http://localhost:8100 npm run dev` |
| The backend alone | `docker compose -f docker-compose.yml -f docker-compose.local.yml up --build debate analytics` |
| The tests | `make test` |
| Health of everything running | `make health` |

The backend is not run outside a container on purpose: it imports the Week 3
tree, which the image clones to `/week3` at a pinned commit. Running it from a
checkout means reproducing that by hand, and then the thing being tested is no
longer the thing that gets deployed. The tests below need no container for
exactly this reason.

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

The running deployment is <https://srv1982020.hstgr.cloud> — a Hostinger VPS
with Traefik in front of it, terminating TLS and routing by path:

| URL | Service |
| --- | --- |
| <https://srv1982020.hstgr.cloud/> | the UI |
| <https://srv1982020.hstgr.cloud/api/health> | debate API (Week 3) |
| <https://srv1982020.hstgr.cloud/analytics/health> | analytics API (Week 4) |
| <https://srv1982020.hstgr.cloud/knowledge/> | retrieval API (Week 1) |

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
curl -fsSL https://raw.githubusercontent.com/Abdo0213/week05_production_app/main/deploy.sh | bash
# fills in .env from the example on the first run, then re-run it
```

The script clones the same repository it is fetched from above, which is the
deployment repository. `github.com/a-3isa/ai-regulation-debate-platform` is a
mirror of it — the two are kept at the same commit, and pushing to only one is
how they stop being. To deploy from a different checkout, set `REPO`:

```bash
REPO=https://github.com/a-3isa/ai-regulation-debate-platform.git ./deploy.sh
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

## Deploying to a host that holds no GitHub token

`deploy.sh` clones the four week repositories **on the server**, which means the
server needs a credential that can read them, sitting on the box for every
future build. The live deployment does not do that: it builds from sources
uploaded to the host, so no GitHub credential ever reaches it. What lives there:

| On the host | What it is |
| --- | --- |
| `/docker/ai-debate/app` | this repository's tracked files |
| `/docker/ai-debate/app/.env` | that host's own configuration and keys, never uploaded |
| `/docker/ai-debate/app/docker-compose.override.yml` | a copy of `compose-override.server.yml` |
| `/docker/ai-debate/app/vendor/week1`, `vendor/week3`, `vendor/week4` | the week sources, uploaded once |

`compose-override.server.yml` points the three builds at
`services/*/Dockerfile.local`, which copy `vendor/<week>` instead of cloning it,
and keeps the bundled `db` out of the default set because that host's corpus
already lives in a database of its own. Compose picks
`docker-compose.override.yml` up automatically, so every command on the host is
the ordinary one - no extra `-f`.

A deploy is then three steps and a check. `git archive` is what makes the first
one safe: it writes exactly the committed tree, so the host's `.env`, its
override file and `vendor/` cannot be clobbered by a stray local file, and an
uncommitted experiment cannot reach production.

```bash
# 1. package the commit you intend to run
git archive --format=tar.gz -o /tmp/app-$(git rev-parse --short HEAD).tar.gz HEAD

# 2. upload it, unpack it in /tmp, and copy it over the checkout
scp /tmp/app-*.tar.gz root@<server>:/tmp/app.tar.gz
ssh root@<server> 'mkdir -p /tmp/stage && tar -xzf /tmp/app.tar.gz -C /tmp/stage && cp -r /tmp/stage/. /docker/ai-debate/app/'

# 3. rebuild only the services whose source changed, and recreate only those
ssh root@<server> 'cd /docker/ai-debate/app && DOCKER_BUILDKIT=1 docker compose build debate && docker compose up -d debate'

# 4. verify from outside, where the users are
curl -fsS https://$PUBLIC_HOST/api/health
curl -fsS https://$PUBLIC_HOST/analytics/health
```

**Check `active_runs` before step 3.** Recreating the `debate` container ends any
debate it is running: the run is restored as `interrupted` afterwards, but the
debate itself cannot resume. `/api/health` reports the count, which is exactly
what `deploy.sh` polls before it touches a running stack (`FORCE=1` skips the
wait). Rebuilding the one service that changed also leaves the others up -
there is no reason for a logging fix in the debate service to restart Week 4.

Afterwards, ask the containers what they are running:

```bash
ssh root@<server> 'cd /docker/ai-debate/app && docker compose exec -T debate cat /SOURCE_REFS'
# week3 (uploaded source, not a clone)
# week2: vendored inside week3
```

That is as specific as this host can be. An uploaded tree carries no `.git`, so
the `Dockerfile.local` variants write that fallback line rather than a commit,
and `make refs` on the deployment host answers with it. Before the fallback
existed the file was simply missing and the command answered `No such file` -
worse, because a missing file reads as a broken image rather than a known
limitation. Naming the real commit would mean stamping it into the tree before
upload; until then, what is running is whatever the last `git archive` packaged.

The helper that drives all of this on the operator's machine (an SSH wrapper
that keeps the host, the user and the password out of the command line) lives
outside this repository on purpose: it is one operator's credentials, not part
of the product.

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
| `LOG_LEVEL` | Threshold for the application log. `INFO` by default — see **Health and logs**. |
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

## Health and logs

Every service answers a health check, and `make health` asks all of them at once:

```bash
make health
# debate    {"status":"ok","analytics_reachable":true,"active_runs":0,...}
# analytics {"status":"ok",...}

curl http://localhost:8100/health          # local overlay
curl https://$PUBLIC_HOST/api/health       # deployed, behind Traefik
```

`/health` is deliberately cheap — it reports liveness, whether the Week 4
service answers, how many debates are running, and the latency-relevant
configuration, so a deployment can be checked without shelling into a
container. It never runs a debate. The same endpoint is each container's
`HEALTHCHECK`, so `docker compose ps` shows `healthy` rather than only `up`.

The debate service logs one timestamped line per request and per debate event,
each carrying the run id:

```bash
make logs                                     # every service, followed
docker compose logs debate                    # one service
docker compose logs debate | grep run_id=abc123   # one debate, end to end
docker compose logs debate | grep ERROR           # only what went wrong
```

```text
2026-09-21 10:15:30 INFO  application_started version=1.0.0 analytics_url=http://analytics:8000 max_rounds=8 ...
2026-09-21 10:15:32 INFO  discussion_created run_id=abc123 rounds=5 strategy=ring agents=all topic="Should the AI Act ..."
2026-09-21 10:15:32 INFO  request method=POST path=/runs status=202 run_id=- duration_ms=4
2026-09-21 10:16:03 INFO  analytics_requested run_id=abc123 round=2
2026-09-21 10:16:07 ERROR analytics_failed run_id=abc123 reason="analytics service unreachable: ..."
2026-09-21 10:18:11 INFO  discussion_completed run_id=abc123 status=completed discussion_id=disc-7f2 events=94
```

Logged events: `application_started`, `runs_restored`, `run_interrupted`,
`request` / `request_failed`, `discussion_created`, `discussion_retrieved`,
`discussion_cancel_requested`, `discussion_completed`, `discussion_failed`,
`stream_opened`, `analytics_requested`, `analytics_rejected`,
`analytics_failed`, `report_requested`, `report_failed`, `charts_requested`,
`member_created`, `member_updated`, `member_deleted`, `members_reset`, and the
persistence failures `run_not_persisted`, `run_not_flushed`,
`run_restore_failed`. Anything that went wrong is at `ERROR` or `WARNING`, so
`grep ERROR` is the whole triage story. `LOG_LEVEL` sets the threshold
(`INFO` by default; `DEBUG` adds the libraries' own chatter). uvicorn's access
log is switched off on purpose — the `request` line above replaces it and has
more in it.

**One line per event, once.** Week 3 configures logging as it is imported, and
one of the handlers it adds to the root logger writes to the console. With two
console handlers on the root logger every line appeared twice, in two different
formats, which is how the deployed log read until `logs.configure()` started
dropping root handlers that write to `stdout` or `stderr` and are not its own.
Week 3's file handlers stay: they are its own record of a discussion under
`/week3/outputs/logs`, not a copy of this service's stdout - and so does
anything writing somewhere else, such as pytest's capture handler, which is why
the check is on the handler's stream and not on its class. One Week 3 line still
arrives unformatted at each boot (`logging initialised - session=...`): it is
emitted while Week 3 is being imported, before `logs.configure()` runs, and
silencing it would mean configuring logging before importing the Week 3 tree.

## Tests

```bash
make test                            # or: python -m pytest services/debate/tests -q
```

These need no containers, no Week 3 checkout, no API key and no network. That
is possible because `services/debate/tests/week3_stub/` supplies exactly the
names `app.runner` imports from Week 3 and nothing else, and because every test
that starts a debate patches `run_debate` and the analytics client. So what is
under test is the layer this repository owns — routing, status codes,
persistence, response shapes, the log line each request produces — and not
Week 3's engine or Week 4's metrics, which are tested in their own repositories.

Covered: `/health` answers 200 and degrades honestly when Week 4 is
unreachable; a run can be started, listed, retrieved, streamed and cancelled; a
retrieved discussion carries three rounds attributed to their agents; the
report and charts come back from Week 4; an unknown run is 404 on every route
and an unfinished one is 409; a failed engine leaves a `failed` run carrying
its reason; a persisted run is restored after a restart; and a sample request
leaves a findable log line.

What they do not cover, and what to run instead:

| Not covered by `make test` | How to check it |
| --- | --- |
| The image builds | `make build` |
| The container starts and the UI is reachable | `make up-local`, then open <http://localhost:5173> |
| The deployed instance is healthy | `curl https://$PUBLIC_HOST/api/health` |
| A real debate end to end | `make up-local` with `OPENROUTER_API_KEY` set, then start a debate in the UI |

## Troubleshooting

**The UI loads but every request fails, or the console shows a CORS error.**
The bundle is calling the wrong API. `VITE_API_BASE` is compiled into the
bundle by Vite at *build* time, so changing it needs `make build` (or
`docker compose up --build`), not a restart. On a server, `DEBATE_CORS_ORIGINS`
must also contain the origin the browser is actually using — it defaults to
`PUBLIC_ORIGIN`.

**`docker build` fails on the clone with `Authentication failed` or
`repository not found`.** The four week repositories are private. Export a
token with `repo:read` as `GIT_TOKEN` before building. If the token is set and
it still fails, the build is running on the legacy builder:
`--mount=type=secret` is a BuildKit feature, so set `DOCKER_BUILDKIT=1` (the
Makefile and both scripts already do).

**A build succeeds but the code is stale.** Docker cached the clone layer.
`make pull` re-clones every week at its pinned ref, ignoring the cache, and
`make refs` prints the commit each running container was actually built from.

**Port already in use on `make up-local`.** The overlay publishes 5173, 8100,
8000, 8200 and 5432. Stop whatever holds the port, or drop the overlay and run
behind Traefik.

**Every agent says the same bland thing, and the UI says the model is
stubbed.** There is no `OPENROUTER_API_KEY`, or `AGENT_LLM_STUB=1`. A wrong
`OPENROUTER_MODEL` slug looks identical from the outside: the provider answers
400 on every turn. Check the slug at <https://openrouter.ai/models>, and check
`llm_model` in `/health`.

**The dashboard says analytics are unavailable.** Either Week 4 rejected an
early round as not yet analysable — legitimate, and the debate continues — or
the service is down. `/health` reports `analytics_reachable`, and
`docker compose logs debate | grep analytics_` says which of the two it was.

**Retrieval fails with `different vector dimensions`.** `WEEK1_EMBEDDING_MODEL`
and `WEEK1_EMBEDDING_DIMENSIONS` must match the corpus in the database, not the
Week 1 example config — see **Serving Week 1 from this stack**.

**A debate is stuck with someone "on the floor" and nothing arriving.** The
service restarted mid-debate. On startup, an unfinished run is marked
`interrupted` with a reason and everything said up to that point is preserved;
reload the page to see the closed session. `grep run_interrupted` in the log
confirms it.

**`docker compose ps` is healthy but `https://$PUBLIC_HOST` is not.** The
failure is in front of the containers, not in them. `deploy.sh` prints the four
things to check when its final health check fails: whether `PUBLIC_HOST`
resolves to this server, whether Traefik is attached to `$TRAEFIK_NETWORK`,
whether the certificate has been issued yet, and whether the app is healthy
inside Docker (`make health`). A certificate that is still being issued looks
exactly like a broken deploy for the first minute or so.

**A deploy dropped debates.** The records live in the `runs` volume. `make
down` keeps every volume; only `make clean` deletes them, and it asks first.

## This week, commit by commit

What the week produced, in the order it happened. Every entry is a commit in this
repository; `git show <sha>` is the detail this table leaves out.

| Commit | What it did |
| --- | --- |
| `d96c49c` | The live platform over the four course repositories: the debate service, the SSE stream, the analytics call, the first UI |
| `91189af` | A self-hosted Week 1 retrieval service, and `deploy.sh` as the one command that deploys the stack |
| `c28e5d9` | A stray file removed - the one a shell-quoting mistake created |
| `6247dd5` | The council-chamber UI, real interaction-graph weights, Week 1 served from this stack |
| `7b2d5e8` | Member management, runs persisted so debates survive a restart, plain-language UI copy |
| `5259365` | The redesign, the live opinion chart, one command for every week, faster debates |
| `9ae6d97` | The uploaded-source build path, for a host that should hold no GitHub token |
| `e63c45f` | Council cards laid out for real member names rather than placeholder ids |
| `f3b75a8` | The dashboard rebuilt on the Forum design system |
| `979d29e` | One timestamped line per request and per debate event, each carrying the run id |
| `87d7d8f` | The API contract covered by tests that need no container, against a Week 3 stub |
| `c66c45d` | The documentation: the live URL, how to run each piece, what to do when it breaks |
| `21c37a4` | Logging fixed so no line prints twice, and a recorded source ref for the uploaded builds |

### How the live instance got to that commit

The deployment was two rounds of the upload path above, and the second round
exists because of what the first one revealed.

1. **`c66c45d` shipped.** The server was running `f3b75a8`, two days behind: the
   logging, the tests and the docs were committed and pushed but never deployed.
   `make test` first (44 passing), then `git archive HEAD`, upload, unpack in
   `/tmp`, copy over `/docker/ai-debate/app`, rebuild `debate` alone - the diff
   touched only that service, the frontend not at all - and recreate it.
   `/api/health`, `/analytics/health` and the UI all answered; `active_runs` was
   `0` throughout, so no debate was cut off.

2. **The new log showed the bug.** Every line appeared twice, in two formats -
   visible only once the service was running in the image, because the duplicate
   comes from Week 3's own logging setup, which the tests stub out. Root cause
   came from asking the running container what handlers it had: two
   `RotatingFileHandler`s and two `StreamHandler`s on the root logger, one of
   them Week 3's. The same check found `/SOURCE_REFS` missing on this host.

3. **`21c37a4` fixed both**, with two tests written first - a foreign console
   handler is dropped, a foreign file handler is kept - then `debate` and
   `knowledge` rebuilt and recreated, and the log re-read to confirm one line per
   event and a ref that answers. `analytics` and `ui` were left running.

4. **Both remotes pushed** to `21c37a4`, so the deployment repository, its mirror
   and the running server agree. That order - deploy, then push - is backwards
   from the habit, and worth naming: the fix was verified against the real image
   before it was published, but until the push the server was ahead of both
   repositories - and on this host no image could have said so, which is the
   limitation the fallback ref line at least names out loud.

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
