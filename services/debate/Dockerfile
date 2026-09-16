# The debate service: Week 3's discussion engine, driven turn by turn and
# streamed over SSE.
#
# Week 3 is cloned at a pinned commit rather than vendored, so this repo never
# holds a second copy of that code that could drift from the original. Bump
# WEEK3_REF to pick up changes there, deliberately.
FROM python:3.12-slim

ARG WEEK3_REPO=https://github.com/a-3isa/Multi-Agent-Collaboration-AI-Regulation-Team_A.git
ARG WEEK3_BRANCH=week3-task-scaffold
ARG WEEK3_REF=93af9b3cb2219351cc888cf97f5769b71889eb3b

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    WEEK3_ROOT=/week3 \
    PYTHONPATH=/week3:/app \
    PORT=8100

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --branch "$WEEK3_BRANCH" "$WEEK3_REPO" /week3 \
    && git -C /week3 checkout --quiet "$WEEK3_REF" \
    && rm -rf /week3/.git

RUN pip install --no-cache-dir -r /week3/requirements.txt

WORKDIR /app
COPY services/debate/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY services/debate/app ./app

# Agent memory is written under /week3/src/vendor/data, and finished runs under
# /data/discussions; both must be writable by the non-root user.
RUN useradd --create-home --uid 10002 debate \
    && mkdir -p /data/discussions /week3/src/vendor/data /week3/outputs/logs \
    && chown -R debate:debate /app /data /week3
USER debate

EXPOSE 8100

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8100/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
