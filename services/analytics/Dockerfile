# Week 4 analytics engine, cloned at a pinned commit.
#
# WHY THIS FILE EXISTS
# The compose file used to build this service straight from a git URL
# (`context: https://github.com/.../Analytics-Intelligence-Layer.git#branch`).
# That worked, but it made Week 4 the odd one out: Weeks 1 and 3 are cloned by
# an explicit Dockerfile at a pinned COMMIT, while Week 4 floated on whatever a
# branch pointed at, could not use a build secret to reach a private repo, and
# had no place to add a dependency or a healthcheck.
#
# Now all four weeks are pinned the same way, in one place - see .env.example.
#
# PRIVATE REPOSITORIES
# Every week repo in this project is private, so the Docker daemon cannot clone
# them anonymously. Pass a token as a BuildKit secret and the clone uses it:
#
#   GIT_TOKEN=ghp_... docker compose build
#
# The secret is mounted only for the RUN that needs it, so it is never written
# into a layer or into the image history. Without a token the clone is
# anonymous, which is correct once the repositories are public.
FROM python:3.12-slim

ARG WEEK4_REPO=https://github.com/YaassminSalahEldin/Analytics-Intelligence-Layer.git
ARG WEEK4_BRANCH=week5/production-followups
ARG WEEK4_REF=bfbdb451d4043ad5f0c1a0c02012164ab5dc0e33

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    PORT=8000

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# `--mount=type=secret` keeps the token out of the image: it exists only for
# the life of this RUN. The credential is written to a throwaway store and
# deleted in the same layer, so `docker history` shows nothing.
RUN --mount=type=secret,id=git_token \
    set -eu; \
    if [ -s /run/secrets/git_token ]; then \
        git config --global credential.helper 'store --file=/tmp/.git-cred'; \
        printf 'https://x-access-token:%s@github.com\n' "$(cat /run/secrets/git_token)" > /tmp/.git-cred; \
    fi; \
    git clone --branch "$WEEK4_BRANCH" "$WEEK4_REPO" /src; \
    if [ -n "$WEEK4_REF" ]; then git -C /src checkout --quiet "$WEEK4_REF"; fi; \
    git -C /src log -1 --format='week4 %H %s' > /app/SOURCE_REF; \
    rm -rf /src/.git /tmp/.git-cred; \
    git config --global --unset credential.helper || true; \
    cp -r /src/. /app/; \
    rm -rf /src

RUN pip install --no-cache-dir -r /app/requirements.txt

# The engine reads discussions from outputs/discussions and writes generated
# artifacts to reports/; both must exist and be writable by the non-root user.
RUN useradd --create-home --uid 10004 analytics \
    && mkdir -p /app/outputs/discussions /app/reports \
    && chown -R analytics:analytics /app
USER analytics

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "src.analytics.api:app", "--host", "0.0.0.0", "--port", "8000"]
