#!/usr/bin/env bash
# Deploy the platform on a server that already runs Traefik.
#
#   ssh root@<server>
#   curl -fsSL https://raw.githubusercontent.com/a-3isa/ai-regulation-debate-platform/main/deploy.sh | bash
#
# or, from a checkout:   ./deploy.sh
#
# The script is idempotent: run it again to pull changes and rebuild.

set -euo pipefail

REPO="${REPO:-https://github.com/a-3isa/ai-regulation-debate-platform.git}"
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
  echo "Fill in PUBLIC_HOST, OPENROUTER_API_KEY and WEEK1_API_KEY, then re-run this script."
  echo "  nano $APP_DIR/.env"
  exit 1
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a

: "${PUBLIC_HOST:?set PUBLIC_HOST in .env}"
if [ -z "${OPENROUTER_API_KEY:-}" ] && [ "${AGENT_LLM_STUB:-0}" != "1" ]; then
  echo "WARNING: OPENROUTER_API_KEY is empty - agents will produce stub turns."
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
say "Building and starting"
COMPOSE_PROFILES="${COMPOSE_PROFILES:-}" docker compose up -d --build

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
say "Checking the public endpoints"
curl -fsS "https://$PUBLIC_HOST/api/health" && echo
curl -fsS "https://$PUBLIC_HOST/analytics/health" && echo

say "Done - open https://$PUBLIC_HOST"
