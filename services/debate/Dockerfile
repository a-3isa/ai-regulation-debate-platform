# The debate service: Week 3's discussion engine, driven turn by turn and
# streamed over SSE.
#
# Week 3 is cloned at a pinned commit rather than vendored, so this repo never
# holds a second copy of that code that could drift from the original. Bump
# WEEK3_REF to pick up changes there, deliberately.
#
# WEEK 2 LIVES INSIDE WEEK 3
# Week 3 vendors the Week 2 agent framework at src/vendor/week2 - the personas,
# the LLM client and the tools all come from there, so cloning Week 3 brings
# Week 2 with it. That is why there is no separate week2 service. To run a
# DIFFERENT Week 2 than the one Week 3 pinned, set WEEK2_OVERLAY=1 and the
# clone below replaces that directory. Off by default: the vendored copy is the
# one Week 3 was tested against.
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
FROM python:3.12-slim

ARG WEEK3_REPO=https://github.com/a-3isa/Multi-Agent-Collaboration-AI-Regulation-Team_A.git
ARG WEEK3_BRANCH=week3-task-scaffold
ARG WEEK3_REF=93af9b3cb2219351cc888cf97f5769b71889eb3b

ARG WEEK2_OVERLAY=0
ARG WEEK2_REPO=https://github.com/a-3isa/Intelligent-Agent-Framework.git
ARG WEEK2_BRANCH=main
ARG WEEK2_REF=

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    WEEK3_ROOT=/week3 \
    PYTHONPATH=/week3:/app \
    PORT=8100

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=secret,id=git_token \
    set -eu; \
    if [ -s /run/secrets/git_token ]; then \
        git config --global credential.helper 'store --file=/tmp/.git-cred'; \
        printf 'https://x-access-token:%s@github.com\n' "$(cat /run/secrets/git_token)" > /tmp/.git-cred; \
    fi; \
    git clone --branch "$WEEK3_BRANCH" "$WEEK3_REPO" /week3; \
    if [ -n "$WEEK3_REF" ]; then git -C /week3 checkout --quiet "$WEEK3_REF"; fi; \
    git -C /week3 log -1 --format='week3 %H %s' > /SOURCE_REFS; \
    if [ "$WEEK2_OVERLAY" = "1" ]; then \
        git clone --branch "$WEEK2_BRANCH" "$WEEK2_REPO" /week2src; \
        if [ -n "$WEEK2_REF" ]; then git -C /week2src checkout --quiet "$WEEK2_REF"; fi; \
        git -C /week2src log -1 --format='week2 %H %s' >> /SOURCE_REFS; \
        rm -rf /week3/src/vendor/week2; \
        if [ -d /week2src/src ]; then cp -r /week2src/src /week3/src/vendor/week2; \
        else cp -r /week2src /week3/src/vendor/week2; fi; \
        rm -rf /week2src /week3/src/vendor/week2/.git; \
    else \
        echo 'week2: vendored inside week3 (WEEK2_OVERLAY=0)' >> /SOURCE_REFS; \
    fi; \
    rm -rf /week3/.git /tmp/.git-cred; \
    git config --global --unset credential.helper || true

RUN pip install --no-cache-dir -r /week3/requirements.txt

WORKDIR /app
COPY services/debate/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY services/debate/app ./app

# Agent memory is written under /week3/src/vendor/data, and finished runs under
# /data/discussions; both must be writable by the non-root user.
# /data/runs holds every debate's event log (restored after a restart), and
# /week3/personas-defaults is an untouched copy of the shipped members that
# "Restore originals" copies back. The persona directory itself is a volume in
# production, so members edited in the UI survive a redeploy.
RUN useradd --create-home --uid 10002 debate \
    && mkdir -p /data/discussions /data/runs /week3/src/vendor/data /week3/outputs/logs \
    && cp -r /week3/src/vendor/week2/personas /week3/personas-defaults \
    && chown -R debate:debate /app /data /week3
USER debate

EXPOSE 8100

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8100/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
