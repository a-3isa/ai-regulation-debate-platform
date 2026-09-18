# One-command control of the whole stack.
#
#   make up          build every week from GitHub and start the stack
#   make up-local    the same, with plain ports instead of Traefik
#   make refs        what each running container was actually built from
#   make logs        follow every service
#   make down        stop, keeping the volumes (debates, members, corpus)
#
# Every target passes GIT_TOKEN through to the builds, because the four week
# repositories are private. Export it once:  export GIT_TOKEN=ghp_...

COMPOSE       ?= docker compose
LOCAL_FILES   := -f docker-compose.yml -f docker-compose.local.yml
# BuildKit is required: the week clones use `--mount=type=secret`, which the
# legacy builder does not understand.
export DOCKER_BUILDKIT := 1
export COMPOSE_DOCKER_CLI_BUILD := 1

.PHONY: help up up-local build pull down stop restart logs ps refs health test check-token clean

help:
	@grep -E '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/' | column -t -s "$$(printf '\t')"

check-token: ## warn if no GitHub token is set (the week repos are private)
	@if [ -z "$$GIT_TOKEN" ]; then \
		echo "NOTE: GIT_TOKEN is not set. The week repositories are private, so"; \
		echo "      the clones will fail with 'could not read Username'."; \
		echo "      export GIT_TOKEN=ghp_...   (a token with repo:read)"; \
	fi

up: check-token ## build every week and start the stack (Traefik)
	$(COMPOSE) up -d --build
	@$(MAKE) --no-print-directory refs

up-local: check-token ## the same, on published ports, no Traefik or TLS
	$(COMPOSE) $(LOCAL_FILES) up -d --build
	@$(MAKE) --no-print-directory refs
	@echo ""
	@echo "  UI         http://localhost:5173"
	@echo "  debate     http://localhost:8100/docs"
	@echo "  analytics  http://localhost:8000/docs"
	@echo "  knowledge  http://localhost:8200"

build: check-token ## rebuild the images without starting anything
	$(COMPOSE) build

pull: check-token ## re-clone every week at its pinned ref, ignoring the cache
	$(COMPOSE) build --no-cache analytics debate knowledge

down: ## stop the stack, keeping every volume
	$(COMPOSE) down

stop: ## stop the containers without removing them
	$(COMPOSE) stop

restart: ## restart every service
	$(COMPOSE) restart

logs: ## follow the logs of every service
	$(COMPOSE) logs -f --tail=100

ps: ## what is running
	$(COMPOSE) ps

refs: ## the commit each running service was built from
	@echo "--- week sources baked into the running images ---"
	@$(COMPOSE) exec -T analytics cat /app/SOURCE_REF 2>/dev/null || echo "analytics: not running"
	@$(COMPOSE) exec -T debate    cat /SOURCE_REFS  2>/dev/null || echo "debate:    not running"
	@$(COMPOSE) exec -T knowledge cat /SOURCE_REFS  2>/dev/null || echo "knowledge: not running"

health: ## ask every service how it is
	@$(COMPOSE) exec -T debate    python -c "import urllib.request;print('debate   ', urllib.request.urlopen('http://127.0.0.1:8100/health',timeout=5).read().decode())" 2>/dev/null || echo "debate:    unreachable"
	@$(COMPOSE) exec -T analytics python -c "import urllib.request;print('analytics', urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=5).read().decode())" 2>/dev/null || echo "analytics: unreachable"

test: ## the tests that need no containers
	python -m pytest services/debate/tests -q

clean: ## stop AND delete every volume - destroys debates, members and corpus
	@echo "This deletes every debate, every edited member and the Week 1 corpus."
	@printf 'Type the word delete to continue: ' && read answer && [ "$$answer" = "delete" ]
	$(COMPOSE) down -v
