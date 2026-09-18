#!/usr/bin/env bash
# Control the whole stack without make. Same verbs as the Makefile.
#
#   ./scripts/stack.sh up          build every week from GitHub, start the stack
#   ./scripts/stack.sh up-local    the same, on published ports, no Traefik
#   ./scripts/stack.sh refs        what each running container was built from
#   ./scripts/stack.sh logs | ps | health | down | stop | restart | build | pull
#
# The four week repositories are private, so the builds need a token:
#   export GIT_TOKEN=ghp_...

set -euo pipefail
cd "$(dirname "$0")/.."

# BuildKit is required: the week clones use `--mount=type=secret`, which the
# legacy builder does not understand.
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

FILES=(-f docker-compose.yml)
COMMAND="${1:-help}"
[ "$COMMAND" = "up-local" ] && FILES+=(-f docker-compose.local.yml)

dc() { docker compose "${FILES[@]}" "$@"; }

check_token() {
  if [ -z "${GIT_TOKEN:-}" ]; then
    echo "NOTE: GIT_TOKEN is not set. The week repositories are private, so the"
    echo "      clones will fail with 'could not read Username'."
    echo "      export GIT_TOKEN=ghp_...   (a token with repo:read)"
  fi
}

refs() {
  echo
  echo "--- week sources baked into the running images ---"
  dc exec -T analytics cat /app/SOURCE_REF 2>/dev/null || echo "analytics: not running"
  dc exec -T debate    cat /SOURCE_REFS    2>/dev/null || echo "debate:    not running"
  dc exec -T knowledge cat /SOURCE_REFS    2>/dev/null || echo "knowledge: not running"
}

case "$COMMAND" in
  up)        check_token; dc up -d --build; refs ;;
  up-local)  check_token; dc up -d --build; refs
             echo
             echo "  UI         http://localhost:5173"
             echo "  debate     http://localhost:8100/docs"
             echo "  analytics  http://localhost:8000/docs"
             echo "  knowledge  http://localhost:8200" ;;
  build)     check_token; dc build ;;
  pull)      check_token; dc build --no-cache analytics debate knowledge ;;
  down)      dc down ;;
  stop)      dc stop ;;
  restart)   dc restart ;;
  logs)      dc logs -f --tail=100 ;;
  ps)        dc ps ;;
  refs)      refs ;;
  health)
    dc exec -T debate    python -c "import urllib.request;print('debate   ', urllib.request.urlopen('http://127.0.0.1:8100/health',timeout=5).read().decode())" 2>/dev/null || echo "debate:    unreachable"
    dc exec -T analytics python -c "import urllib.request;print('analytics', urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=5).read().decode())" 2>/dev/null || echo "analytics: unreachable" ;;
  test)      python -m pytest services/debate/tests -q ;;
  *)         sed -n '2,10p' "$0" ;;
esac
