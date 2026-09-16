// Where the debate service lives. Set VITE_API_BASE at build time to point the
// UI at a deployed backend; the default keeps `npm run dev` working against a
// service running locally.
export const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8100').replace(/\/$/, '');

async function asJson(response) {
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep the status line */
    }
    throw new Error(detail);
  }
  return response.json();
}

export function startRun({ topic, numRounds, strategy }) {
  return fetch(`${API_BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, num_rounds: numRounds, strategy }),
  }).then(asJson);
}

export function cancelRun(runId) {
  return fetch(`${API_BASE}/runs/${runId}`, { method: 'DELETE' }).then(asJson);
}

export function fetchCharts(runId) {
  return fetch(`${API_BASE}/runs/${runId}/charts`).then(asJson);
}

export function fetchHealth() {
  return fetch(`${API_BASE}/health`).then(asJson);
}

export function discussionUrl(runId) {
  return `${API_BASE}/runs/${runId}/discussion`;
}

// The stream replays from event 0, so a late or reconnecting listener still
// sees the whole debate.
export function openStream(runId) {
  return new EventSource(`${API_BASE}/runs/${runId}/stream`);
}

export const STREAM_EVENTS = [
  'run_started',
  'round_started',
  'turn_started',
  'message',
  'retrieval',
  'opinion',
  'round_complete',
  'analytics',
  'analytics_unavailable',
  'report',
  'notice',
  'run_complete',
  'run_failed',
  'stream_end',
];
