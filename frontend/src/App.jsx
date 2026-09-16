// Live debate UI: type a topic, watch the agents argue, see Week 4's analytics
// update every round, and get the full Week 4 deliverables when it ends.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Activity,
  AlertTriangle,
  BarChart2,
  BookOpen,
  Download,
  FileText,
  Loader2,
  MessageSquare,
  Network,
  Play,
  Search,
  Square,
  TrendingUp,
  Users,
} from 'lucide-react';

import {
  AgreementTrend,
  Empty,
  InfluenceRanking,
  OpinionTrajectory,
  SentimentPanel,
  agentColor,
  prettyName,
} from './Analytics.jsx';
import { API_BASE, cancelRun, discussionUrl, fetchCharts, openStream, startRun } from './api.js';

const TERMINAL = new Set(['completed', 'converged', 'failed', 'cancelled']);

const initialRun = {
  runId: null,
  status: 'idle',
  meta: null,
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

export default function App() {
  const [topic, setTopic] = useState('');
  const [numRounds, setNumRounds] = useState(3);
  const [strategy, setStrategy] = useState('ring');
  const [run, setRun] = useState(initialRun);
  const [charts, setCharts] = useState(null);
  const [starting, setStarting] = useState(false);
  const streamRef = useRef(null);
  const transcriptRef = useRef(null);

  const running = run.status === 'running' || run.status === 'pending';

  // --- stream wiring -------------------------------------------------------

  const handleEvent = useCallback((type, event) => {
    const data = event.data || {};
    setRun((prev) => {
      switch (type) {
        case 'run_started':
          return { ...prev, status: 'running', meta: data };
        case 'round_started':
          return { ...prev, currentRound: data.round, speaking: null };
        case 'turn_started':
          return { ...prev, speaking: data.persona_id };
        case 'message':
          return { ...prev, messages: [...prev.messages, data], speaking: null };
        case 'retrieval':
          return { ...prev, retrievals: [...prev.retrievals, data] };
        case 'opinion': {
          const forAgent = prev.opinions[data.persona_id] || [];
          return {
            ...prev,
            opinions: { ...prev.opinions, [data.persona_id]: [...forAgent, data] },
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

    const listeners = [
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
    ].map((type) => {
      const handler = (event) => handleEvent(type, JSON.parse(event.data));
      source.addEventListener(type, handler);
      return [type, handler];
    });

    source.onerror = () => {
      // EventSource retries on its own; the stream replays from the start, so a
      // reconnect cannot lose events. Only a finished run closes it for good.
      setRun((prev) => (TERMINAL.has(prev.status) ? prev : prev));
    };

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

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [run.messages.length, run.speaking]);

  // --- actions -------------------------------------------------------------

  async function onStart(event) {
    event.preventDefault();
    if (!topic.trim() || starting || running) return;
    setStarting(true);
    setCharts(null);
    setRun({ ...initialRun, status: 'pending' });
    try {
      const response = await startRun({ topic: topic.trim(), numRounds, strategy });
      setRun((prev) => ({ ...prev, runId: response.run_id, status: 'running' }));
    } catch (error) {
      setRun({ ...initialRun, status: 'failed', error: error.message });
    } finally {
      setStarting(false);
    }
  }

  function onStop() {
    if (run.runId) cancelRun(run.runId).catch(() => {});
  }

  const agents = run.meta?.agents || [];
  const messagesByRound = groupBy(run.messages, (m) => m.round);
  const finished = TERMINAL.has(run.status) && run.status !== 'failed';

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1>AI Regulation Debate Platform</h1>
          <p className="muted">
            Week 1 retrieval → Week 2 personas → Week 3 discussion → Week 4 analytics, live.
          </p>
        </div>
        <span className="muted small">{API_BASE}</span>
      </header>

      <form className="controls" onSubmit={onStart}>
        <label className="grow">
          <span>Topic</span>
          <input
            type="text"
            value={topic}
            maxLength={300}
            placeholder="e.g. mandatory third-party audits for high-risk AI systems"
            onChange={(event) => setTopic(event.target.value)}
            disabled={running}
          />
        </label>
        <label>
          <span>Rounds</span>
          <input
            type="number"
            min={3}
            max={8}
            value={numRounds}
            onChange={(event) => setNumRounds(Number(event.target.value))}
            disabled={running}
          />
        </label>
        <label>
          <span>Topology</span>
          <select value={strategy} onChange={(event) => setStrategy(event.target.value)} disabled={running}>
            <option value="ring">Ring</option>
            <option value="mesh">Mesh</option>
          </select>
        </label>
        {running ? (
          <button type="button" className="danger" onClick={onStop}>
            <Square size={16} /> Stop
          </button>
        ) : (
          <button type="submit" disabled={!topic.trim() || starting}>
            <Play size={16} /> {starting ? 'Starting…' : 'Start debate'}
          </button>
        )}
      </form>

      {run.status === 'idle' && (
        <div className="panel intro">
          <p>
            Type a topic and start. Four personas — an EU regulator, a startup founder, a civil
            society advocate and an academic researcher — form an opinion grounded in the Week 1
            knowledge base, then argue over the number of rounds you choose. Every metric below is
            computed by the Week 4 engine as the debate unfolds.
          </p>
        </div>
      )}

      {run.error && (
        <div className="panel error">
          <AlertTriangle size={18} /> {run.error}
        </div>
      )}

      {run.runId && (
        <>
          <section className="status-strip">
            <StatusCard icon={<Activity size={16} />} label="Status" value={statusLabel(run)} />
            <StatusCard
              icon={<Users size={16} />}
              label="Agents"
              value={agents.length ? String(agents.length) : '—'}
            />
            <StatusCard
              icon={<MessageSquare size={16} />}
              label="Messages"
              value={String(run.messages.length)}
            />
            <StatusCard
              icon={<Search size={16} />}
              label="Retrievals"
              value={String(run.retrievals.length)}
            />
            <StatusCard
              icon={<TrendingUp size={16} />}
              label="Round"
              value={`${Math.min(run.currentRound, run.meta?.num_rounds ?? numRounds)} / ${
                run.meta?.num_rounds ?? numRounds
              }`}
            />
          </section>

          {run.meta?.llm_stubbed && (
            <div className="panel warn">
              <AlertTriangle size={16} /> The LLM is stubbed: agent turns are deterministic
              placeholders, not real model output. Set OPENROUTER_API_KEY on the debate service for
              a real debate.
            </div>
          )}

          <div className="layout">
            <section className="panel transcript-panel">
              <h2>
                <MessageSquare size={18} /> Debate
              </h2>
              <div className="transcript" ref={transcriptRef}>
                <AgentStances agents={agents} opinions={run.opinions} />
                {run.messages.length === 0 && !run.speaking && (
                  <Empty label="Agents are forming their initial opinions from the knowledge base…" />
                )}
                {[...messagesByRound.entries()].map(([round, messages]) => (
                  <div key={round} className="round-block">
                    <div className="round-label">Round {round}</div>
                    {messages.map((message) => (
                      <Message key={message.message_id} message={message} agents={agents} />
                    ))}
                  </div>
                ))}
                {run.speaking && (
                  <div className="speaking">
                    <Loader2 size={14} className="spin" /> {prettyName(run.speaking)} is thinking…
                  </div>
                )}
              </div>
            </section>

            <section className="analytics-column">
              <div className="panel">
                <h2>
                  <TrendingUp size={18} /> Opinion trajectory
                </h2>
                <OpinionTrajectory analytics={run.analytics} />
              </div>
              <div className="panel">
                <h2>
                  <Activity size={18} /> Agreement per round
                </h2>
                <AgreementTrend analytics={run.analytics} />
              </div>
              <div className="panel">
                <h2>
                  <BarChart2 size={18} /> Influence
                </h2>
                <InfluenceRanking analytics={run.analytics} />
              </div>
              <div className="panel">
                <h2>
                  <MessageSquare size={18} /> Sentiment
                </h2>
                <SentimentPanel analytics={run.analytics} messages={run.messages} />
              </div>
              {run.retrievals.length > 0 && (
                <div className="panel">
                  <h2>
                    <BookOpen size={18} /> Evidence retrieved
                  </h2>
                  <ul className="evidence">
                    {run.retrievals.slice(-6).reverse().map((event, index) => (
                      <li key={`${event.persona_id}-${event.round}-${index}`}>
                        <strong>{prettyName(event.persona_id)}</strong> · round {event.round} ·{' '}
                        {event.result_count} result{event.result_count === 1 ? '' : 's'}
                        <span className="muted"> — “{event.query}”</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>

          {run.notices.length > 0 && (
            <section className="panel notices">
              <h2>
                <AlertTriangle size={18} /> Notices
              </h2>
              <ul>
                {run.notices.map((notice, index) => (
                  <li key={index}>{notice}</li>
                ))}
              </ul>
            </section>
          )}

          {finished && (
            <Deliverables run={run} charts={charts} />
          )}
        </>
      )}
    </div>
  );
}

// --- pieces ----------------------------------------------------------------

function StatusCard({ icon, label, value }) {
  return (
    <div className="status-card">
      <span className="muted small">
        {icon} {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function AgentStances({ agents, opinions }) {
  if (!agents.length) return null;
  return (
    <div className="stance-row">
      {agents.map((agent, index) => {
        const history = opinions[agent] || [];
        const latest = history[history.length - 1];
        const previous = history[history.length - 2];
        const stance = latest?.stance_score;
        const delta =
          typeof stance === 'number' && typeof previous?.stance_score === 'number'
            ? stance - previous.stance_score
            : null;
        return (
          <div key={agent} className="stance-card" style={{ borderColor: agentColor(index) }}>
            <span className="agent-name">{prettyName(agent)}</span>
            <span className="stance-value">
              {typeof stance === 'number' ? stance.toFixed(2) : '—'}
              {delta ? (
                <em className={delta > 0 ? 'up' : 'down'}>
                  {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(2)}
                </em>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Message({ message, agents }) {
  const index = Math.max(0, agents.indexOf(message.sender));
  return (
    <article className="message" style={{ borderLeftColor: agentColor(index) }}>
      <header>
        <strong style={{ color: agentColor(index) }}>{prettyName(message.sender)}</strong>
        <span className="muted small">→ {message.recipients.map(prettyName).join(', ')}</span>
        {message.used_retrieval && (
          <span className="tag">
            <Search size={11} /> evidence
          </span>
        )}
      </header>
      <p>{message.content}</p>
    </article>
  );
}

function Deliverables({ run, charts }) {
  const analytics = run.analytics;
  const reportBlob = run.report
    ? URL.createObjectURL(new Blob([run.report], { type: 'text/markdown' }))
    : null;
  const analyticsBlob = analytics
    ? URL.createObjectURL(new Blob([JSON.stringify(analytics, null, 2)], { type: 'application/json' }))
    : null;

  return (
    <section className="deliverables">
      <h2 className="section-heading">
        <FileText size={20} /> Week 4 deliverables
      </h2>
      <p className="muted">
        The debate is {run.status}. Everything below is produced by the Week 4 engine from this
        run's discussion record.
      </p>

      <div className="deliverable-grid">
        <div className="panel">
          <h3>Opinion trajectory chart</h3>
          {charts?.opinion_trajectory_png ? (
            <img
              alt="Opinion trajectory"
              src={`data:image/png;base64,${charts.opinion_trajectory_png}`}
            />
          ) : (
            <Empty label="Chart not available." />
          )}
        </div>
        <div className="panel">
          <h3>
            <Network size={16} /> Interaction graph
          </h3>
          {charts?.interaction_graph_png ? (
            <img
              alt="Interaction graph"
              src={`data:image/png;base64,${charts.interaction_graph_png}`}
            />
          ) : (
            <Empty label="Graph not available." />
          )}
        </div>
      </div>

      <div className="panel">
        <h3>Automatic report</h3>
        {run.report ? (
          <div className="markdown">
            <ReactMarkdown>{run.report}</ReactMarkdown>
          </div>
        ) : (
          <Empty label="Report not available." />
        )}
      </div>

      <div className="downloads">
        {reportBlob && (
          <a className="button" href={reportBlob} download={`report_${run.meta?.discussion_id || run.runId}.md`}>
            <Download size={16} /> report.md
          </a>
        )}
        {analyticsBlob && (
          <a
            className="button"
            href={analyticsBlob}
            download={`analytics_${run.meta?.discussion_id || run.runId}.json`}
          >
            <Download size={16} /> analytics_result.json
          </a>
        )}
        <a className="button" href={discussionUrl(run.runId)} target="_blank" rel="noreferrer">
          <Download size={16} /> discussion record
        </a>
      </div>
    </section>
  );
}

// --- helpers ---------------------------------------------------------------

function groupBy(items, keyOf) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyOf(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return map;
}

function statusLabel(run) {
  if (run.status === 'converged') return 'converged early';
  if (run.status === 'running') return 'debating';
  return run.status;
}
