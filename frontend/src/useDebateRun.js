// Owns one debate run: starts it, follows its event stream, and folds the
// events into the shape the pages render from.
//
// The stream replays from event 0, so remounting this hook (navigating between
// pages) re-renders the whole debate rather than losing what came before.

import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelRun, fetchCharts, openStream, startRun } from './api.js';

export const TERMINAL = new Set(['completed', 'converged', 'failed', 'cancelled']);

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
};

export function useDebateRun() {
  const [run, setRun] = useState(emptyRun);
  const [charts, setCharts] = useState(null);
  const [starting, setStarting] = useState(false);
  const streamRef = useRef(null);

  const running = run.status === 'running' || run.status === 'pending';

  const handleEvent = useCallback((type, event) => {
    const data = event.data || {};
    setRun((prev) => {
      switch (type) {
        case 'run_started':
          return { ...prev, status: 'running', meta: data, personas: data.personas || {} };
        case 'round_started':
          return { ...prev, currentRound: data.round, speaking: null };
        case 'turn_started':
          return { ...prev, speaking: data.persona_id, currentRound: data.round };
        case 'message':
          return { ...prev, messages: [...prev.messages, data], speaking: null };
        case 'retrieval':
          return { ...prev, retrievals: [...prev.retrievals, data] };
        case 'opinion': {
          const history = prev.opinions[data.persona_id] || [];
          return {
            ...prev,
            opinions: { ...prev.opinions, [data.persona_id]: [...history, data] },
          };
        }
        case 'round_complete':
          return { ...prev, rounds: [...prev.rounds, data] };
        case 'analytics':
          return { ...prev, analytics: data.analytics };
        case 'analytics_unavailable':
          return {
            ...prev,
            notices: [...prev.notices, `Round ${data.round}: analytics unavailable (${data.reason})`],
          };
        case 'report':
          return { ...prev, report: data.markdown, analytics: data.analytics || prev.analytics };
        case 'notice':
          return { ...prev, notices: [...prev.notices, data.message] };
        case 'run_complete':
          return { ...prev, status: data.status || 'completed', speaking: null };
        case 'run_failed':
          return { ...prev, status: 'failed', error: data.error, speaking: null };
        case 'stream_end':
          return { ...prev, status: data.status || prev.status, speaking: null };
        default:
          return prev;
      }
    });
  }, []);

  useEffect(() => {
    if (!run.runId) return undefined;

    const source = openStream(run.runId);
    streamRef.current = source;

    const listeners = EVENT_TYPES.map((type) => {
      const handler = (event) => handleEvent(type, JSON.parse(event.data));
      source.addEventListener(type, handler);
      return [type, handler];
    });

    return () => {
      listeners.forEach(([type, handler]) => source.removeEventListener(type, handler));
      source.close();
      streamRef.current = null;
    };
  }, [run.runId, handleEvent]);

  // Close the stream and pull the final charts once the debate ends.
  useEffect(() => {
    if (!run.runId || !TERMINAL.has(run.status)) return;
    if (streamRef.current) {
      streamRef.current.close();
      streamRef.current = null;
    }
    if (run.status === 'failed' || charts) return;
    fetchCharts(run.runId)
      .then(setCharts)
      .catch(() => setCharts(null));
  }, [run.status, run.runId, charts]);

  const start = useCallback(async ({ topic, numRounds, strategy }) => {
    if (!topic.trim()) return;
    setStarting(true);
    setCharts(null);
    setRun({ ...emptyRun, status: 'pending' });
    try {
      const response = await startRun({ topic: topic.trim(), numRounds, strategy });
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
