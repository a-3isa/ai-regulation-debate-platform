// Owns one debate run: starts it, follows its event stream, and folds the
// events into the shape the pages render from.
//
// The stream replays from event 0, so remounting this hook (navigating between
// pages) re-renders the whole debate rather than losing what came before.
//
// TELLING A SLOW MODEL FROM A DEAD RUN
// A turn can legitimately take a minute or more while the model thinks, and
// the browser's EventSource retries silently when a connection drops. Without a
// check, a run that died server-side looks identical to a slow one: the page
// sits on "is speaking" forever. So whenever the connection errors, and
// whenever nothing has arrived for a while, the hook asks the server what the
// run's status really is - and says so on screen.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, cancelRun, fetchCharts, fetchRun, openStream, startRun } from './api.js';

export const TERMINAL = new Set(['completed', 'converged', 'failed', 'cancelled', 'interrupted', 'lost']);

//: How long without any event before the hook checks on the run.
const QUIET_CHECK_MS = 90_000;

const EVENT_TYPES = [
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

export const emptyRun = {
  runId: null,
  status: 'idle',
  meta: null,
  personas: {},
  messages: [],
  retrievals: [],
  opinions: {},
  rounds: [],
  analytics: null,
  report: null,
  notices: [],
  error: null,
  currentRound: 0,
  speaking: null,
  slow: false,
};

export function useDebateRun() {
  const [run, setRun] = useState(emptyRun);
  const [charts, setCharts] = useState(null);
  const [starting, setStarting] = useState(false);
  const streamRef = useRef(null);
  const lastEventAt = useRef(Date.now());

  const running = run.status === 'running' || run.status === 'pending';

  const handleEvent = useCallback((type, event) => {
    lastEventAt.current = Date.now();
    const data = event.data || {};
    setRun((prev) => {
      const base = prev.slow ? { ...prev, slow: false } : prev;
      switch (type) {
        case 'run_started':
          return { ...base, status: 'running', meta: data, personas: data.personas || {} };
        case 'round_started':
          return { ...base, currentRound: data.round, speaking: null };
        case 'turn_started':
          return { ...base, speaking: data.persona_id, currentRound: data.round };
        case 'message':
          return { ...base, messages: [...base.messages, data], speaking: null };
        case 'retrieval':
          return { ...base, retrievals: [...base.retrievals, data] };
        case 'opinion': {
          const history = base.opinions[data.persona_id] || [];
          return { ...base, opinions: { ...base.opinions, [data.persona_id]: [...history, data] } };
        }
        case 'round_complete':
          return { ...base, rounds: [...base.rounds, data] };
        case 'analytics':
          return { ...base, analytics: data.analytics };
        case 'analytics_unavailable':
          return {
            ...base,
            notices: [...base.notices, `Round ${data.round}: analytics unavailable (${data.reason})`],
          };
        case 'report':
          return { ...base, report: data.markdown, analytics: data.analytics || base.analytics };
        case 'notice':
          return { ...base, notices: [...base.notices, data.message] };
        case 'run_complete':
          return { ...base, status: data.status || 'completed', speaking: null };
        case 'run_failed':
          return { ...base, status: data.status || 'failed', error: data.error, speaking: null };
        case 'stream_end':
          return {
            ...base,
            status: TERMINAL.has(base.status) ? base.status : data.status || base.status,
            speaking: null,
          };
        default:
          return base;
      }
    });
  }, []);

  // Ask the server what really happened to the run.
  const checkRun = useCallback(async (runId) => {
    try {
      const summary = await fetchRun(runId);
      if (TERMINAL.has(summary.status)) {
        setRun((prev) => ({
          ...prev,
          status: summary.status,
          error: summary.error || prev.error,
          speaking: null,
          slow: false,
        }));
      } else {
        // Alive, just slow: say so instead of looking frozen.
        setRun((prev) => (prev.status === 'running' ? { ...prev, slow: true } : prev));
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setRun((prev) => ({
          ...prev,
          status: 'lost',
          speaking: null,
          slow: false,
          error:
            'This debate is no longer on the server - most likely the service restarted and the ' +
            'session was lost. What was said so far is shown below; start a new debate to continue.',
        }));
      }
      // Any other failure is probably our own connection; EventSource keeps retrying.
    }
  }, []);

  useEffect(() => {
    if (!run.runId) return undefined;

    const source = openStream(run.runId);
    streamRef.current = source;
    lastEventAt.current = Date.now();

    const listeners = EVENT_TYPES.map((type) => {
      const handler = (event) => handleEvent(type, JSON.parse(event.data));
      source.addEventListener(type, handler);
      return [type, handler];
    });

    source.onerror = () => checkRun(run.runId);

    const watchdog = setInterval(() => {
      if (Date.now() - lastEventAt.current > QUIET_CHECK_MS) {
        lastEventAt.current = Date.now(); // one check per quiet period
        checkRun(run.runId);
      }
    }, 15_000);

    return () => {
      clearInterval(watchdog);
      listeners.forEach(([type, handler]) => source.removeEventListener(type, handler));
      source.close();
      streamRef.current = null;
    };
  }, [run.runId, handleEvent, checkRun]);

  // Close the stream and pull the final charts once the debate ends.
  useEffect(() => {
    if (!run.runId || !TERMINAL.has(run.status)) return;
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
    if (!['completed', 'converged', 'cancelled'].includes(run.status) || charts) return;
    fetchCharts(run.runId)
      .then(setCharts)
      .catch(() => setCharts(null));
  }, [run.status, run.runId, charts]);

  const start = useCallback(async ({ topic, numRounds, strategy, agents }) => {
    if (!topic.trim()) return;
    setStarting(true);
    setCharts(null);
    setRun({ ...emptyRun, status: 'pending' });
    try {
      const response = await startRun({ topic: topic.trim(), numRounds, strategy, agents });
      setRun((prev) => ({ ...prev, runId: response.run_id, status: 'running' }));
    } catch (error) {
      setRun({ ...emptyRun, status: 'failed', error: error.message });
    } finally {
      setStarting(false);
    }
  }, []);

  const stop = useCallback(() => {
    if (run.runId) cancelRun(run.runId).catch(() => {});
  }, [run.runId]);

  const attach = useCallback((runId) => {
    setCharts(null);
    setRun({ ...emptyRun, runId, status: 'running' });
  }, []);

  return { run, charts, starting, running, start, stop, attach };
}
