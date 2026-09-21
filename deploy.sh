#!/usr/bin/env bash
# Deploy the platform on a server that already runs Traefik.
#
#   ssh root@<server>
#   curl -fsSL https://raw.githubusercontent.com/Abdo0213/week05_production_app/main/deploy.sh | bash
#
# or, from a checkout:   ./deploy.sh
#
# The script is idempotent: run it again to pull changes and rebuild.
#
# The four week repositories are private, so the builds need a GitHub token
# with repo:read. Put GIT_TOKEN in .env, or export it before running:
#
#   GIT_TOKEN=ghp_... ./deploy.sh
#
# It is passed to BuildKit as a secret, so it never lands in an image layer.

set -euo pipefail

REPO="${REPO:-https://github.com/Abdo0213/week05_production_app.git}"
DEPLOY_DIR="${DEPLOY_DIR:-/docker/ai-debate}"
NETWORK="${NETWORK:-platform_edge}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# --- 1. code -------------------------------------------------------------
if [ -f docker-compose.yml ] && [ -d services/debate ]; then
  APP_DIR="$PWD"                      # already inside a checkout
else
  say "Fetching $REPO into $DEPLOY_DIR/app"
  mkdir -p "$DEPLOY_DIR"
  if [ -d "$DEPLOY_DIR/app/.git" ]; then
    git -C "$DEPLOY_DIR/app" pull --ff-only
  else
    git clone "$REPO" "$DEPLOY_DIR/app"
  fi
  APP_DIR="$DEPLOY_DIR/app"
fi
cd "$APP_DIR"

# --- 2. configuration ----------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  say "Created $APP_DIR/.env from the example"
  echo "Fill in PUBLIC_HOST, GIT_TOKEN, OPENROUTER_API_KEY and WEEK1_API_KEY, then re-run."
  echo "  nano $APP_DIR/.env"
  exit 1
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a

: "${PUBLIC_HOST:?set PUBLIC_HOST in .env}"
if [ -z "${OPENROUTER_API_KEY:-}" ] && [ "${AGENT_LLM_STUB:-0}" != "1" ]; then
  echo "WARNING: OPENROUTER_API_KEY is empty - agents will produce stub turns."
fi
if [ -z "${GIT_TOKEN:-}" ]; then
  echo "WARNING: GIT_TOKEN is empty. The week repositories are private, so the"
  echo "         builds will fail with \"could not read Username\"."
fi

# --- 3. network ----------------------------------------------------------
if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  say "Creating docker network $NETWORK"
  docker network create "$NETWORK"
fi

# Traefik must be able to reach this network. With Traefik in host-network
# mode (it routes to container IPs directly) nothing more is needed; when it
# runs in a bridge network, attach it once:
#   docker network connect $NETWORK <traefik-container>
if docker ps --format '{{.Names}}' | grep -qi traefik; then
  TRAEFIK_CONTAINER="$(docker ps --format '{{.Names}}' | grep -i traefik | head -1)"
  TRAEFIK_MODE="$(docker inspect "$TRAEFIK_CONTAINER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}')"
  case "$TRAEFIK_MODE" in
    *host*) : ;;                                     # reaches container IPs directly
    *"$NETWORK"*) : ;;                               # already attached
    *) say "Attaching $TRAEFIK_CONTAINER to $NETWORK"
       docker network connect "$NETWORK" "$TRAEFIK_CONTAINER" || true ;;
  esac
else
  echo "NOTE: no Traefik container found - the routing labels will do nothing."
  echo "      Use docker-compose.local.yml to publish ports directly instead."
fi

# --- 4. never kill a debate in progress -----------------------------------
# Recreating the debate container ends any debate it is running. Runs are
# restored as "interrupted" afterwards, but the debate itself cannot resume, so
# wait for the service to be idle unless FORCE=1.
if docker compose ps --status running --services 2>/dev/null | grep -qx debate; then
  for attempt in $(seq 1 60); do
    active="$(docker compose exec -T debate python -c "
import json, urllib.request
print(json.load(urllib.request.urlopen('http://127.0.0.1:8100/health', timeout=5)).get('active_runs', 0))
" 2>/dev/null || echo 0)"
    [ "${active:-0}" = "0" ] && break
    if [ "${FORCE:-0}" = "1" ]; then
      echo "WARNING: $active debate(s) running - FORCE=1 set, deploying anyway."
      break
    fi
    [ "$attempt" = "1" ] && say "$active debate(s) in progress - waiting for them to finish (FORCE=1 to skip)"
    sleep 15
  done
fi

# --- 5. build and start --------------------------------------------------
# BuildKit is required: the week clones use `--mount=type=secret`, which the
# legacy builder does not understand.
say "Building every week from GitHub and starting the stack"
export DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1
docker compose up -d --build

# --- 6. verify -----------------------------------------------------------
say "Waiting for the services to report healthy"
for _ in $(seq 1 30); do
  if docker compose exec -T debate python -c "
import urllib.request, sys
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8100/health', timeout=3).status == 200 else 1)
" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

docker compose ps

# Which commit of each week is actually running. Worth printing on every
# deploy: "it is broken on the server" is a different problem depending on
# whether the server is running the ref you think it is.
say "Week sources baked into the running images"
docker compose exec -T analytics cat /app/SOURCE_REF 2>/dev/null || echo "analytics: no ref recorded"
docker compose exec -T debate    cat /SOURCE_REFS   2>/dev/null || echo "debate:    no ref recorded"
docker compose exec -T knowledge cat /SOURCE_REFS   2>/dev/null || echo "knowledge: no ref recorded"

# `set -e` would otherwise abort here with nothing but a curl exit code, after
# a deploy that actually succeeded - the stack can be healthy inside Docker
# while the public name is not resolvable or the certificate is still being
# issued. Report which of the two it is, and keep the non-zero exit.
say "Checking the public endpoints"
public_ok=1
for path in /api/health /analytics/health; do
  if curl -fsS --max-time 15 "https://$PUBLIC_HOST$path"; then
    echo
  else
    public_ok=0
    echo "FAILED: https://$PUBLIC_HOST$path"
  fi
done

if [ "$public_ok" = "1" ]; then
  say "Done - open https://$PUBLIC_HOST"
else
  say "The stack is up, but it is not reachable at https://$PUBLIC_HOST"
  echo "The containers above are what Docker thinks; the failure is in front of them."
  echo "  - does $PUBLIC_HOST resolve to this server?      dig +short $PUBLIC_HOST"
  echo "  - is Traefik on the same network?                docker network inspect $NETWORK"
  echo "  - has the certificate been issued yet?           docker logs <traefik> | tail"
  echo "  - is the app itself healthy inside Docker?       make health"
  exit 1
fi
