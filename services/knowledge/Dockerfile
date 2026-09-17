# Week 1 knowledge base (retrieval API), self-hosted instead of Vercel.
#
# Same pattern as the debate service: the Week 1 repository is cloned at a
# pinned commit rather than vendored, so this repo holds no second copy of it.
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

RUN git clone --branch "$WEEK1_BRANCH" "$WEEK1_REPO" /week1 \
    && git -C /week1 checkout --quiet "$WEEK1_REF" \
    && rm -rf /week1/.git

# The retrieval API needs only the serving dependencies; the ingestion stack
# (beautifulsoup4, lxml, trafilatura, tiktoken, ddgs) is never imported here.
RUN pip install --no-cache-dir -r /week1/api/requirements.txt gunicorn>=22.0

WORKDIR /week1

RUN useradd --create-home --uid 10003 knowledge && chown -R knowledge:knowledge /week1
USER knowledge

EXPOSE 8200

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8200/', timeout=4).status in (200, 401) else 1)"

# app.py exposes a module-level `app`; api/index.py is the Vercel wrapper and is
# not used here.
CMD ["gunicorn", "--bind", "0.0.0.0:8200", "--workers", "2", "--timeout", "60", "webui.app:app"]
