// Where the debate service lives. Set VITE_API_BASE at build time to point the
// UI at a deployed backend; the default keeps `npm run dev` working against a
// service running locally.
export const API_BASE = (import.meta.env.VITE_API_BASE || 'http://localhost:8100').replace(/\/$/, '');

// An error that keeps the server's structured detail, so forms can show each
// field's validation message next to that field.
export class ApiError extends Error {
  constructor(status, detail) {
    const message =
      typeof detail === 'string'
        ? detail
        : detail?.errors
          ? detail.errors.map((e) => e.message).join(' ')
          : `${status} error`;
    super(message);
    this.status = status;
    this.detail = detail;
    this.fieldErrors = Array.isArray(detail?.errors) ? detail.errors : [];
  }
}

async function asJson(response) {
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.detail !== undefined) detail = body.detail;
    } catch {
      /* keep the status line */
    }
    throw new ApiError(response.status, detail);
  }
  return response.json();
}

function send(method, path, body) {
  return fetch(`${API_BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(asJson);
}

// --- debates ---------------------------------------------------------------

export function startRun({ topic, numRounds, strategy, agents }) {
  return send('POST', '/runs', {
    topic,
    num_rounds: numRounds,
    strategy,
    agents: agents?.length ? agents : undefined,
  });
}

export function cancelRun(runId) {
  return send('DELETE', `/runs/${runId}`);
}

export function fetchRun(runId) {
  return send('GET', `/runs/${runId}`);
}

export function fetchCharts(runId) {
  return send('GET', `/runs/${runId}/charts`);
}

export function fetchHealth() {
  return send('GET', '/health');
}

export function discussionUrl(runId) {
  return `${API_BASE}/runs/${runId}/discussion`;
}

// The stream replays from event 0, so a late or reconnecting listener still
// sees the whole debate.
export function openStream(runId) {
  return new EventSource(`${API_BASE}/runs/${runId}/stream`);
}

// --- members (personas) ----------------------------------------------------

export const listPersonas = () => send('GET', '/personas').then((b) => b.personas);
export const fetchVocabulary = () => send('GET', '/personas/vocabulary');
export const createPersona = (persona) => send('POST', '/personas', persona);
export const updatePersona = (id, persona) => send('PUT', `/personas/${id}`, persona);
export const deletePersona = (id) => send('DELETE', `/personas/${id}`);
export const resetPersonas = () => send('POST', '/personas/reset').then((b) => b.personas);
