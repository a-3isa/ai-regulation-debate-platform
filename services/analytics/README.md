# Analytics service

This folder has no Dockerfile on purpose.

The Week 4 analytics service is built straight from its own repository — see
the `analytics` service in `docker-compose.yml`, whose build context is a git
URL pinned to a ref. That repo already ships a Dockerfile, so copying one here
would mean maintaining a second, silently diverging copy.

The debate service talks to it over `ANALYTICS_URL` and uses three routes:

- `POST /inline/analytics` — metrics for the in-progress discussion, once per round
- `POST /inline/report` — the final Markdown report
- `POST /inline/visualizations` — the two required charts as base64 PNGs
