# Week 1 knowledge base (retrieval API), self-hosted instead of Vercel.
#
# Same pattern as the debate service: the Week 1 repository is cloned at a
# pinned commit rather than vendored, so this repo holds no second copy of it.
#
# PRIVATE REPOSITORIES
# Every week repo in this project is private, so the daemon cannot clone them
# anonymously. Pass a token as a BuildKit secret and the clone uses it:
#
#   GIT_TOKEN=ghp_... docker compose build
#
# The secret is mounted only for the RUN that needs it, so it never reaches a
# layer or the image history. Without a token the clone is anonymous, which is
# what you want once the repositories are public.
#
# It needs a PostgreSQL database with pgvector that already contains the
# embedded corpus (DATABASE_URL), and the same embedding model the corpus was
# built with (OPENAI_API_KEY) so a query vector is comparable to the stored
# ones. Without both it starts and answers, but every search returns an error
# naming the missing variable.
FROM python:3.12-slim

ARG WEEK1_REPO=https://github.com/a-3isa/week1-ai-regulation-pipeline.git
ARG WEEK1_BRANCH=week1-ai-regulation-pipeline
ARG WEEK1_REF=d8e6637e8dbfeee809152d6133292a54538a8188

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/week1/src \
    PORT=8200

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=secret,id=git_token \
    set -eu; \
    if [ -s /run/secrets/git_token ]; then \
        git config --global credential.helper 'store --file=/tmp/.git-cred'; \
        printf 'https://x-access-token:%s@github.com\n' "$(cat /run/secrets/git_token)" > /tmp/.git-cred; \
    fi; \
    git clone --branch "$WEEK1_BRANCH" "$WEEK1_REPO" /week1; \
    if [ -n "$WEEK1_REF" ]; then git -C /week1 checkout --quiet "$WEEK1_REF"; fi; \
    git -C /week1 log -1 --format='week1 %H %s' > /SOURCE_REFS; \
    rm -rf /week1/.git /tmp/.git-cred; \
    git config --global --unset credential.helper || true

# The retrieval API needs only the serving dependencies; the ingestion stack
# (beautifulsoup4, lxml, trafilatura, tiktoken, ddgs) is never imported here.
RUN pip install --no-cache-dir -r /week1/api/requirements.txt gunicorn>=22.0

WORKDIR /week1

RUN useradd --create-home --uid 10003 knowledge && chown -R knowledge:knowledge /week1
USER knowledge

EXPOSE 8200

# Liveness only: is gunicorn accepting connections. An HTTP check does not work
# here - the root page answers 401 when API_KEY is set, and urlopen() raises on
# a 401 instead of returning it, so a healthy, gated service would read as down.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import socket; socket.create_connection(('127.0.0.1', 8200), 3).close()"

# app.py exposes a module-level `app`; api/index.py is the Vercel wrapper and is
# not used here.
# --access-logfile - sends one line per request to stdout, so
# `docker compose logs knowledge` shows which searches were served here.
CMD ["gunicorn", "--bind", "0.0.0.0:8200", "--workers", "2", "--timeout", "60", "--access-logfile", "-", "webui.app:app"]
