// The pages behind the nav. Each reads from the same run object, so moving
// between them never interrupts a debate in progress.

import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ExternalLink } from 'lucide-react';

import { useAgentColors } from './AgentColorContext.jsx';
import {
  AgreementTrend,
  Empty,
  InfluenceRanking,
  OpinionTrajectory,
  SentimentPanel,
  fmt,
  prettyName,
} from './Analytics.jsx';
import { ClosingBand, LiveTrajectory, NowSpeaking, RoundProgress } from './Live.jsx';
import { ChamberRing, Floor, MemberCard, Seat, displayName } from './Stage.jsx';
import { API_BASE, discussionUrl } from './api.js';
import { statusLabel } from './App.jsx';

const MIN_ROUNDS = 3;
const MAX_ROUNDS = 8;

const SUGGESTIONS = [
  'Open-source models should be exempt from high-risk obligations',
  'Real-time biometric ID should be banned outright',
  'Foundation-model providers should carry the compliance burden',
];

const TOPOLOGIES = [
  { id: 'ring', name: 'Ring', glyph: 'M8,8 H32 M32,8 V23 M32,23 H8 M8,23 V8' },
  { id: 'mesh', name: 'Mesh', glyph: 'M8,8 H32 M8,23 H32 M8,8 V23 M32,8 V23 M8,8 L32,23 M32,8 L8,23' },
];

const HOW_IT_WORKS = [
  'Each member retrieves from the Act, then writes a turn addressed to whoever the graph says they are talking to.',
  'A scorer reads that turn and places the speaker on the −2…+2 stance scale. The point lands on the chart live.',
  'After every round the analytics engine recomputes agreement, influence and sentiment. Thin evidence is withheld, not guessed.',
];

// --- debate ----------------------------------------------------------------

export function ChamberPage({
  run, members, running, starting, onStart, onStop, onManageMembers, onOpenAnalytics, onOpenReport,
}) {
  if (run.status === 'idle') {
    return (
      <Composer
        members={members}
        starting={starting}
        onStart={onStart}
        onManageMembers={onManageMembers}
      />
    );
  }
  return (
    <LiveDebate
      run={run}
      running={running}
      onStop={onStop}
      onOpenAnalytics={onOpenAnalytics}
      onOpenReport={onOpenReport}
    />
  );
}

/** The empty state. This is where a human is deciding something, so it is the
 *  one screen allowed display type, warmth and a little room to breathe. */
function Composer({ members, starting, onStart, onManageMembers }) {
  const { colorFor } = useAgentColors();
  const [topic, setTopic] = useState('');
  const [rounds, setRounds] = useState(5);
  const [strategy, setStrategy] = useState('ring');
  const [seated, setSeated] = useState(null);

  const chosen = seated ?? members.map((m) => m.id);
  const tooFew = members.length > 0 && chosen.length < 2;

  function toggle(id) {
    const base = seated ?? members.map((m) => m.id);
    setSeated(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
  }

  function submit(event) {
    event.preventDefault();
    if (tooFew || !topic.trim()) return;
    onStart({ topic: topic.trim(), numRounds: rounds, strategy, agents: seated ? chosen : undefined });
  }

  return (
    <form className="composer-wrap" onSubmit={submit}>
      <div className="composer-main">
        <div className="kicker">New debate</div>
        <h1 className="composer-title">What should they argue about?</h1>
        <p className="muted small" style={{ maxWidth: '46ch', margin: '0 0 var(--s-5)' }}>
          Four members, one question, and 900 pages of the AI Act to argue from. Nobody gets to
          make anything up.
        </p>

        <div className="topic-box">
          <label>
            <span className="sr-only">Debate topic</span>
            <input
              type="text"
              value={topic}
              maxLength={300}
              placeholder="Ask them something worth five rounds"
              onChange={(e) => setTopic(e.target.value)}
            />
          </label>
          <div className="topic-foot">
            <span className="num">{topic.length} / 300</span>
            <span>Grounded in the EU AI Act</span>
          </div>
        </div>

        <div className="suggestions">
          <span className="micro">Try:</span>
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip-suggest" onClick={() => setTopic(s)}>
              {s}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 'var(--s-4)', marginTop: 'var(--s-6)' }}>
          <div className="setting-card">
            <div className="field-label" style={{ marginBottom: 'var(--s-3)' }}>Rounds</div>
            <div className="stepper">
              <button type="button" aria-label="Fewer rounds" onClick={() => setRounds((r) => Math.max(MIN_ROUNDS, r - 1))}>−</button>
              <span className="value">{rounds}</span>
              <button type="button" aria-label="More rounds" onClick={() => setRounds((r) => Math.min(MAX_ROUNDS, r + 1))}>+</button>
              <div className="round-ticks" aria-hidden="true">
                {Array.from({ length: MAX_ROUNDS }, (_, i) => (
                  <span key={i} className={i < rounds ? 'on' : undefined} />
                ))}
              </div>
            </div>
            <div className="micro" style={{ marginTop: 'var(--s-2)' }}>
              ≈ {rounds * members.length || 0} turns
            </div>
          </div>

          <div className="setting-card">
            <div className="field-label" style={{ marginBottom: 'var(--s-3)' }}>Who addresses whom</div>
            <div className="topology-row">
              {TOPOLOGIES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={strategy === t.id}
                  onClick={() => setStrategy(t.id)}
                >
                  <svg viewBox="0 0 40 30" aria-hidden="true">
                    <path d={t.glyph} fill="none" stroke="var(--ink-3)" strokeWidth="1.1" />
                    <circle cx="8" cy="8" r="3" fill="var(--ink-2)" />
                    <circle cx="32" cy="8" r="3" fill="var(--ink-2)" />
                    <circle cx="8" cy="23" r="3" fill="var(--ink-2)" />
                    <circle cx="32" cy="23" r="3" fill="var(--ink-2)" />
                  </svg>
                  <span className="nm">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 'var(--s-5)' }}>
          <div className="field-label" style={{ marginBottom: 'var(--s-3)' }}>Members at the table</div>
          <div className="member-chips">
            {members.map((m) => {
              const on = chosen.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  className="member-chip"
                  aria-pressed={on}
                  onClick={() => toggle(m.id)}
                  style={{ '--who': colorFor(m.id) }}
                >
                  <span className="seat seat-sm" style={{ '--who': colorFor(m.id) }} aria-hidden="true">
                    {initialsOf(m.name)}
                  </span>
                  <strong>{m.name}</strong>
                </button>
              );
            })}
            <button type="button" className="btn-link" onClick={onManageMembers}>Manage members</button>
          </div>
          {tooFew && <p className="field-hint error-text">Pick at least two members.</p>}
          {members.length === 0 && <p className="muted small">Gathering the council…</p>}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--s-3)', marginTop: 'var(--s-6)' }}>
          <button type="submit" className="btn-primary" disabled={!topic.trim() || starting || tooFew}>
            {starting ? 'Opening…' : 'Open the floor'}
          </button>
          <span className="micro">Streams over SSE · you can stop it mid-round</span>
        </div>
      </div>

      <aside className="composer-aside">
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', marginBottom: 'var(--s-4)' }}>
          How a round works
        </div>
        <ol className="how-steps">
          {HOW_IT_WORKS.map((text, i) => (
            <li key={i}>
              <span className="n">{i + 1}</span>
              <p>{text}</p>
            </li>
          ))}
        </ol>
        <div className="micro" style={{ marginTop: 'var(--s-5)', paddingTop: 'var(--s-4)', borderTop: '1px solid var(--line)', lineHeight: 1.6 }}>
          Every claim a member makes is retrieved from the Act before it is written. If retrieval
          comes back thin, you see it flagged rather than smoothed over.
        </div>
      </aside>
    </form>
  );
}

function LiveDebate({ run, running, onStop, onOpenAnalytics, onOpenReport }) {
  const agents = run.meta?.agents || [];
  const personas = run.personas || {};
  const totalRounds = run.meta?.num_rounds ?? 0;
  const finished = ['completed', 'converged', 'cancelled'].includes(run.status);

  const stances = Object.fromEntries(
    Object.entries(run.opinions).map(([agent, history]) => [
      agent,
      history[history.length - 1]?.stance_score,
    ])
  );
  const lastMessage = run.messages[run.messages.length - 1];
  const turnsBy = {};
  run.messages.forEach((m) => { turnsBy[m.sender] = (turnsBy[m.sender] || 0) + 1; });

  return (
    <>
      <div className="status-strip" role="status" aria-live="polite">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', minWidth: 0, flex: '1 1 260px' }}>
          <span
            className={running ? 'status-dot live' : 'status-dot'}
            style={{ background: running ? 'var(--ok)' : 'var(--ink-4)' }}
            aria-hidden="true"
          />
          <span className="small" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
            {statusLabel(run.status)}
          </span>
          <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <NowSpeaking run={run} />
          </span>
        </div>
        <RoundProgress current={run.currentRound} total={totalRounds} finished={finished} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', marginLeft: 'auto' }}>
          <span className="micro">{run.messages.length} turns · {run.retrievals.length} lookups</span>
          {running && <button type="button" className="btn-quiet" onClick={onStop}>Stop after this turn</button>}
        </div>
      </div>

      <ClosingBand run={run} />

      <div className="chamber">
        <div className="chamber-rail">
          <section className="panel">
            <div className="panel-head">
              <h2>The table</h2>
              <span className="micro" style={{ marginLeft: 'auto' }}>
                {finished ? 'final routing' : 'edge = who listens'}
              </span>
            </div>
            <ChamberRing
              agents={agents}
              personas={personas}
              graph={run.meta?.graph}
              speaking={run.speaking}
              lastMessage={lastMessage}
              stances={stances}
              compact={finished}
            />
          </section>

          {agents.map((agent) => {
            const history = run.opinions[agent] || [];
            const latest = history[history.length - 1];
            const previous = history[history.length - 2];
            const delta =
              typeof latest?.stance_score === 'number' && typeof previous?.stance_score === 'number'
                ? latest.stance_score - previous.stance_score
                : null;
            return (
              <MemberCard
                key={agent}
                personaId={agent}
                persona={personas[agent]}
                personas={personas}
                stance={latest?.stance_score}
                delta={delta}
                turns={turnsBy[agent] || 0}
                speaking={run.speaking === agent}
              />
            );
          })}
        </div>

        <div className="chamber-main">
          <section className="panel">
            <div className="panel-head">
              <h2>Opinion trajectory</h2>
              <span className="micro">live, off the event stream</span>
            </div>
            <LiveTrajectory run={run} />
          </section>

          <section className="transcript">
            <div className="transcript-head">
              <h2 style={{ margin: 0, fontSize: 'var(--t-h3)', fontWeight: 600 }}>Transcript</h2>
              <span className="micro">{run.meta?.topic}</span>
            </div>
            <Floor run={run} personas={personas} />
          </section>

          {finished && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-3)' }}>
              <button type="button" className="btn-primary" onClick={onOpenAnalytics}>Open analytics</button>
              <button type="button" onClick={onOpenReport}>Read the report</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function initialsOf(name) {
  return (name || '?')
    .split(/\s+/)
    .filter((p) => p && !/^(dr|prof|mr|ms|mrs)\.?$/i.test(p))
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

// --- analytics -------------------------------------------------------------

export function AnalyticsPage({ run }) {
  if (!run.analytics) {
    return (
      <section className="panel" style={{ marginTop: 'var(--s-5)' }}>
        <h1 style={{ margin: '0 0 var(--s-3)', fontSize: 'var(--t-h2)', fontFamily: 'var(--font-display)', fontWeight: 400 }}>
          Analytics
        </h1>
        <Empty label="Measured charts appear once the first round finishes. The Debate page carries a live view of the positions in the meantime." />
      </section>
    );
  }

  const analytics = run.analytics;
  const warnings = analytics.warnings || [];
  const rounds = (analytics.agreement || []).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)', paddingTop: 'var(--s-5)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 'var(--s-3)' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div className="kicker">Measured, not narrated</div>
          <h1 style={{ margin: 'var(--s-1) 0 0', fontSize: 'var(--t-h2)', fontFamily: 'var(--font-display)', fontWeight: 400, letterSpacing: '-.01em' }}>
            {run.meta?.topic || 'This debate'}
          </h1>
        </div>
        {/* One key for the whole page. Every chart below is coloured by member,
            so four separate legends would be the same information four times. */}
        <AgentLegend agents={run.meta?.agents || Object.keys(analytics.opinion_change || {})} personas={run.personas} />
      </div>

      {/* Data quality first, not buried at the bottom: a withheld number is a
          finding, and a reader who scrolls past it will misread everything
          above it. */}
      {warnings.length > 0 && (
        <section className="panel warn">
          <div className="panel-head">
            <h2>Data quality</h2>
            <p className="panel-note">Shown first, not buried. A withheld number is a finding.</p>
          </div>
          <ul className="quality-list">
            {warnings.map((w, i) => (
              <li key={i}>
                <span className="dot" style={{ background: 'var(--warn)' }} aria-hidden="true" />
                <span>{w.message || String(w)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>Opinion trajectory</h2>
            <p className="panel-note">Stance −2…+2 per round. Crossings matter more than levels.</p>
          </div>
          <OpinionTrajectory analytics={analytics} />
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Agreement</h2>
            <p className="panel-note">Mean pairwise stance proximity, 0–1. 1.00 is unanimity.</p>
          </div>
          <AgreementTrend analytics={analytics} />
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Influence</h2>
          <span className="micro" style={{ marginLeft: 'auto' }}>
            computed after round {rounds ? rounds - 1 : 0}
          </span>
          <p className="panel-note">
            How far listeners&apos; stances moved after reading this member. Magnitude is one fact,
            the evidence behind it is a second, the direction is a third. They are never merged.
          </p>
        </div>
        <InfluenceRanking analytics={analytics} />
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>Sentiment per turn</h2>
            <p className="panel-note">One bar per message, in speaking order, coloured by speaker.</p>
          </div>
          <SentimentPanel analytics={analytics} messages={run.messages} />
        </section>

        {run.retrievals.length > 0 && (
          <section className="panel">
            <div className="panel-head">
              <h2>Evidence used</h2>
              <span className="micro" style={{ marginLeft: 'auto' }}>{run.retrievals.length} lookups</span>
            </div>
            <ul className="evidence-list">
              {run.retrievals.slice().reverse().slice(0, 8).map((event, index) => (
                <li key={`${event.persona_id}-${event.round}-${index}`}>
                  <span className="cite">r{event.round}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="title">“{event.query}”</div>
                    <div className="sub">
                      {prettyName(event.persona_id)} · {event.source} · {event.result_count} result
                      {event.result_count === 1 ? '' : 's'}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {run.notices.length > 0 && (
        <section className="panel warn">
          <div className="panel-head"><h2>Notices</h2></div>
          <ul className="quality-list">
            {run.notices.map((notice, index) => (
              <li key={index}>
                <span className="dot" style={{ background: 'var(--warn)' }} aria-hidden="true" />
                <span>{notice}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The page-level key: one swatch per member, shared by every chart below. */
function AgentLegend({ agents, personas }) {
  const { colorFor } = useAgentColors();
  if (!agents?.length) return null;
  return (
    <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
      {[...agents].sort().map((agent) => (
        <span
          key={agent}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 11px 4px 8px', borderRadius: 'var(--r-full)',
            background: 'var(--surface)', boxShadow: 'var(--e-1)',
            fontSize: 'var(--t-xs)',
          }}
        >
          <span
            aria-hidden="true"
            style={{ width: 8, height: 8, borderRadius: 2, background: colorFor(agent) }}
          />
          {displayName(personas, agent)}
        </span>
      ))}
    </div>
  );
}

// --- report ----------------------------------------------------------------

export function RecordPage({ run, charts }) {
  const finished = ['completed', 'converged', 'cancelled'].includes(run.status);

  // The notice the debate service emits when Week 4 declines to write the
  // report - the last one, because a run that was retried carries more than one.
  const reportProblem = useMemo(
    () => [...(run.notices || [])].reverse().find((notice) => /report unavailable/i.test(notice)),
    [run.notices]
  );

  const hrefs = useMemo(() => {
    if (!finished) return {};
    const out = {};
    if (run.report) out.report = URL.createObjectURL(new Blob([run.report], { type: 'text/markdown' }));
    if (run.analytics) {
      out.analytics = URL.createObjectURL(
        new Blob([JSON.stringify(run.analytics, null, 2)], { type: 'application/json' })
      );
    }
    return out;
  }, [finished, run.report, run.analytics]);

  useEffect(() => () => Object.values(hrefs).forEach((url) => URL.revokeObjectURL(url)), [hrefs]);

  if (!finished) {
    return (
      <section className="panel" style={{ marginTop: 'var(--s-5)' }}>
        <h1 style={{ margin: '0 0 var(--s-3)', fontSize: 'var(--t-h2)', fontFamily: 'var(--font-display)', fontWeight: 400 }}>
          Report
        </h1>
        <Empty label="The written report is ready the moment the council finishes." />
      </section>
    );
  }

  return (
    <div className="record" style={{ paddingTop: 'var(--s-5)' }}>
      <div className="grid-2">
        {/* The PNGs are drawn on white on purpose — that is what makes them
            comparable to the live charts. Framed as plates rather than tinted
            to match the theme, which would break the comparison. */}
        <figure className="plate">
          {charts?.opinion_trajectory_png ? (
            <img alt="Opinion trajectory, as exported" src={`data:image/png;base64,${charts.opinion_trajectory_png}`} />
          ) : (
            <Empty label="Chart unavailable." />
          )}
          <figcaption>exported chart · white background by design</figcaption>
        </figure>
        <figure className="plate">
          {charts?.interaction_graph_png ? (
            <img alt="Interaction graph, as exported" src={`data:image/png;base64,${charts.interaction_graph_png}`} />
          ) : (
            <Empty label="Graph unavailable." />
          )}
          <figcaption>exported chart · white background by design</figcaption>
        </figure>
      </div>

      <section className="panel">
        {run.report ? (
          <div className="markdown">
            <ReactMarkdown>{run.report}</ReactMarkdown>
          </div>
        ) : (
          // A report can be genuinely unavailable for a debate that ran fine:
          // Week 4 validates a discussion before it computes anything, and
          // rejects the whole thing if one round is missing a stance. The reason
          // is already on the run as a notice, so print it here rather than
          // sending the reader to the container logs for something this page
          // was told.
          <>
            <Empty label="No report was produced for this debate." />
            {reportProblem ? (
              <p className="muted" style={{ margin: 'var(--s-3) 0 0' }}>
                Week 4 answered: {reportProblem.replace(/^final report unavailable:\s*/i, '')}
              </p>
            ) : (
              <p className="muted" style={{ margin: 'var(--s-3) 0 0' }}>
                The run carries no reason for it. `docker compose logs debate | grep report_`
                has the request that was made.
              </p>
            )}
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Downloads</h2></div>
        <div className="download-row">
          {hrefs.report && (
            <a className="button" href={hrefs.report} download={`report_${run.meta?.discussion_id || run.runId}.md`}>
              report.md
            </a>
          )}
          {hrefs.analytics && (
            <a className="button" href={hrefs.analytics} download={`analytics_${run.meta?.discussion_id || run.runId}.json`}>
              analytics_result.json
            </a>
          )}
          <a className="button" href={discussionUrl(run.runId)} target="_blank" rel="noreferrer">
            transcript JSON <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
      </section>
    </div>
  );
}

// --- history ---------------------------------------------------------------

export function ArchivePage({ onOpen, currentRunId }) {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/runs`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status}`))))
      .then((body) => setRuns(body.runs || []))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <section className="panel" style={{ marginTop: 'var(--s-5)' }}>
      <div className="panel-head">
        <h1 style={{ margin: 0, fontSize: 'var(--t-h2)', fontFamily: 'var(--font-display)', fontWeight: 400 }}>
          Past sessions
        </h1>
        <p className="panel-note">
          Kept on the server — including debates that were interrupted before they finished.
        </p>
      </div>

      {error && <p className="banner error">Could not load the archive: {error}</p>}
      {!error && !runs && <Empty label="Looking up past sessions…" />}
      {!error && runs && runs.length === 0 && (
        <Empty label="No debates on record yet — start one and it will be kept here." />
      )}

      {runs && runs.length > 0 && (
        <table className="archive">
          <thead>
            <tr>
              <th scope="col">Topic</th>
              <th scope="col">Status</th>
              <th scope="col" style={{ textAlign: 'right' }}>Rounds</th>
              <th scope="col">Started</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {runs.slice().reverse().map((entry) => (
              <tr key={entry.run_id} style={entry.run_id === currentRunId ? { background: 'var(--surface-2)' } : undefined}>
                <td>{entry.topic}</td>
                <td><span className={`chip ${entry.status}`}>{entry.status}</span></td>
                <td className="num">{entry.num_rounds}</td>
                <td className="micro">{new Date(entry.started_at).toLocaleString()}</td>
                <td><button type="button" className="btn-sm" onClick={() => onOpen(entry.run_id)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// --- about -----------------------------------------------------------------

export function AboutPage() {
  const links = [
    ['Debate API', `${API_BASE}/docs`, 'Start runs, follow the stream, fetch reports and charts.'],
    ['Analytics API', `${API_BASE.replace(/\/api$/, '')}/analytics/docs`, 'The Week 4 engine: metrics, report, visualizations.'],
    ['Service health', `${API_BASE}/health`, 'Liveness, the model in use, and the latency settings.'],
  ];

  const repos = [
    ['Week 1 — knowledge base', 'https://github.com/a-3isa/week1-ai-regulation-pipeline'],
    ['Week 2 — agent framework', 'https://github.com/a-3isa/Intelligent-Agent-Framework'],
    ['Week 3 — discussion engine', 'https://github.com/a-3isa/Multi-Agent-Collaboration-AI-Regulation-Team_A'],
    ['Week 4 — analytics layer', 'https://github.com/YaassminSalahEldin/Analytics-Intelligence-Layer'],
  ];

  return (
    <div style={{ paddingTop: 'var(--s-5)' }}>
      <div className="kicker">About</div>
      <h1 style={{ margin: 'var(--s-2) 0 var(--s-5)', fontSize: 'var(--t-h1)', fontFamily: 'var(--font-display)', fontWeight: 400, letterSpacing: '-.018em' }}>
        Four members, one question, and the Act
      </h1>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><h2>How a debate works</h2></div>
          <ol className="steps">
            <li><strong>Opening positions.</strong> Each member forms a view from the Week 1 evidence, scored from −2 to +2.</li>
            <li><strong>Rounds.</strong> Members take turns, each replying to whoever the graph connects them to.</li>
            <li><strong>Evidence.</strong> When challenged, a member retrieves from the Act mid-debate.</li>
            <li><strong>Analytics.</strong> After every round the Week 4 engine measures opinion change, agreement, influence and sentiment.</li>
            <li><strong>Report.</strong> At the end: a written report with the closing exchange, both charts, and the full transcript.</li>
          </ol>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Service endpoints</h2></div>
          <ul className="link-list">
            {links.map(([label, href, note]) => (
              <li key={href}>
                <a href={href} target="_blank" rel="noreferrer">
                  {label} <ExternalLink size={13} aria-hidden="true" />
                </a>
                <span className="micro block">{note}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel span-2">
          <div className="panel-head"><h2>Source</h2></div>
          <ul className="link-list two-col">
            {repos.map(([label, href]) => (
              <li key={href}>
                <a href={href} target="_blank" rel="noreferrer">
                  {label} <ExternalLink size={13} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export { fmt, displayName, Seat };
