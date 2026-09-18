// Shell: masthead, topic composer, navigation, and hash routing.
//
// Routing is hash-based on purpose - the UI is served as static files behind
// Traefik, and a hash route needs no server-side rewrite rules to survive a
// refresh or a shared link.
//
// The whole tree sits inside an AgentColorProvider seeded from the union of
// "members on file" and "members seated in this run", so one member is one
// colour everywhere: the seat chips here, the ring, the transcript, all four
// charts, and the PNGs in the report. See agentColors.js.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  FileText,
  Gavel,
  History,
  Info,
  Loader2,
  MessageSquare,
  Monitor,
  Moon,
  Play,
  Scale,
  Square,
  Sun,
  Users,
} from 'lucide-react';

import { AgentColorProvider, useAgentColors } from './AgentColorContext.jsx';
import { listPersonas } from './api.js';
import { MembersPage } from './Members.jsx';
import { AboutPage, AnalyticsPage, ArchivePage, ChamberPage, RecordPage } from './Pages.jsx';
import { useTheme } from './theme.js';
import { TERMINAL, useDebateRun } from './useDebateRun.js';

const PAGES = [
  { id: 'debate', label: 'Debate', icon: MessageSquare },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'report', label: 'Report', icon: FileText },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'history', label: 'History', icon: History },
  { id: 'about', label: 'About', icon: Info },
];

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };
const THEME_LABEL = { system: 'Auto', light: 'Light', dark: 'Dark' };

function currentPage() {
  const id = window.location.hash.replace(/^#\/?/, '');
  return PAGES.some((p) => p.id === id) ? id : 'debate';
}

export default function App() {
  const { run, charts, starting, running, start, stop, attach } = useDebateRun();
  const [page, setPage] = useState(currentPage);
  const [topic, setTopic] = useState('');
  const [numRounds, setNumRounds] = useState(4);
  const [strategy, setStrategy] = useState('ring');
  const [members, setMembers] = useState([]);
  const [seated, setSeated] = useState(null); // null = everyone

  const loadMembers = useCallback(() => {
    listPersonas()
      .then((list) => {
        setMembers(list);
        // Drop any selected member that no longer exists.
        setSeated((prev) => (prev ? prev.filter((id) => list.some((m) => m.id === id)) : prev));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    const onHashChange = () => {
      const next = currentPage();
      setPage(next);
      if (next === 'debate') loadMembers();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [loadMembers]);

  function go(id) {
    window.location.hash = `#/${id}`;
    setPage(id);
    if (id === 'debate') loadMembers();
  }

  const chosen = seated ?? members.map((m) => m.id);
  const tooFew = members.length > 0 && chosen.length < 2;

  // Every id the colour registry should know about. A debate loaded from the
  // archive can name a member that has since been deleted, so the run's own
  // agent list has to be in here as well as the current roster.
  const colorIds = useMemo(
    () => [...new Set([...members.map((m) => m.id), ...(run.meta?.agents || [])])],
    [members, run.meta]
  );

  function toggleMember(id) {
    const base = seated ?? members.map((m) => m.id);
    setSeated(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
  }

  function onSubmit(event) {
    event.preventDefault();
    if (tooFew) return;
    start({ topic, numRounds, strategy, agents: seated ? chosen : undefined });
    go('debate');
  }

  function openPast(runId) {
    attach(runId);
    go('debate');
  }

  const roundsSeen = run.meta?.num_rounds ?? numRounds;
  const showForm = page === 'debate';

  return (
    <AgentColorProvider ids={colorIds}>
      <div className="app">
        <a className="skip-link" href="#main">Skip to content</a>

        <header className="masthead">
          <div className="crest">
            <span className="crest-mark" aria-hidden="true">
              <Scale size={19} />
            </span>
            <div>
              <h1>The AI Regulation Council</h1>
              <p className="muted small">AI personas debating AI policy, with live analysis</p>
            </div>
          </div>

          <div className="masthead-tools">
            <nav aria-label="Sections">
              <ul className="nav">
                {PAGES.map(({ id, label, icon: Icon }) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => go(id)}
                      className={page === id ? 'nav-item active' : 'nav-item'}
                      aria-current={page === id ? 'page' : undefined}
                    >
                      <Icon size={14} aria-hidden="true" /> {label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <ThemeControl />
          </div>
        </header>

        {showForm && (
          <form className="motion-form" onSubmit={onSubmit}>
            <label className="grow">
              <span>Debate topic</span>
              <input
                type="text"
                value={topic}
                maxLength={300}
                placeholder="e.g. open-source AI models should be exempt from high-risk rules"
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
              <span>Who hears whom</span>
              <select value={strategy} onChange={(event) => setStrategy(event.target.value)} disabled={running}>
                <option value="ring">Each hears one other (ring)</option>
                <option value="mesh">Everyone hears everyone</option>
              </select>
            </label>
            {running ? (
              <button type="button" className="danger" onClick={stop}>
                <Square size={15} aria-hidden="true" /> Stop debate
              </button>
            ) : (
              <button type="submit" disabled={!topic.trim() || starting || tooFew}>
                {starting ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                {starting ? 'Starting…' : 'Start debate'}
              </button>
            )}

            {members.length > 0 && (
              <SeatPicker
                members={members}
                chosen={chosen}
                disabled={running}
                tooFew={tooFew}
                onToggle={toggleMember}
                onManage={() => go('members')}
              />
            )}
          </form>
        )}

        {run.runId && showForm && (
          <section className="status-strip" aria-label="Debate status">
            <StatusCard icon={<Activity size={13} />} label="Status" value={statusLabel(run.status)} />
            <StatusCard
              icon={<Gavel size={13} />}
              label="Round"
              value={`${Math.min(run.currentRound, roundsSeen)} of ${roundsSeen}`}
            />
            <StatusCard icon={<MessageSquare size={13} />} label="Messages" value={String(run.messages.length)} />
            <StatusCard icon={<BarChart3 size={13} />} label="Evidence lookups" value={String(run.retrievals.length)} />
          </section>
        )}

        {run.slow && running && (
          <p className="banner warn" role="status">
            <Loader2 size={15} className="spin" aria-hidden="true" /> Still working - the model is taking
            longer than usual on this turn. The debate is running on the server.
          </p>
        )}

        {run.meta?.llm_stubbed && (
          <p className="banner warn" role="status">
            The AI model is switched off - members are returning placeholder text, not real arguments.
          </p>
        )}

        {run.error && (
          <p className={run.status === 'interrupted' || run.status === 'lost' ? 'banner warn' : 'banner error'} role="alert">
            {run.error}
          </p>
        )}

        <main id="main">
          {page === 'debate' && <ChamberPage run={run} members={members} />}
          {page === 'analytics' && <AnalyticsPage run={run} />}
          {page === 'report' && <RecordPage run={run} charts={charts} />}
          {page === 'members' && <MembersPage debating={running} />}
          {page === 'history' && <ArchivePage onOpen={openPast} currentRunId={run.runId} />}
          {page === 'about' && <AboutPage />}
        </main>

        <footer className="foot muted small">
          Week 1 retrieval → Week 2 personas → Week 3 discussion → Week 4 analytics.
          {run.analytics?.sentiment_backend && <> Tone scored with {run.analytics.sentiment_backend}.</>}
        </footer>
      </div>
    </AgentColorProvider>
  );
}

// Split out so it can use the colour registry - a hook cannot be called inside
// the `members.map` of a parent that also renders the provider.
function SeatPicker({ members, chosen, disabled, tooFew, onToggle, onManage }) {
  const { colorFor } = useAgentColors();
  return (
    <fieldset className="seat-picker" disabled={disabled}>
      <legend>
        Taking part ({chosen.length} of {members.length})
      </legend>
      <div className="chips">
        {members.map((member) => {
          const on = chosen.includes(member.id);
          return (
            <button
              key={member.id}
              type="button"
              className={on ? 'chip-toggle on' : 'chip-toggle'}
              style={on ? { '--who': colorFor(member.id) } : undefined}
              aria-pressed={on}
              onClick={() => onToggle(member.id)}
            >
              {member.name}
            </button>
          );
        })}
        <button type="button" className="link-button" onClick={onManage}>
          Manage members
        </button>
      </div>
      {tooFew && <p className="field-hint error-text">Pick at least two members.</p>}
    </fieldset>
  );
}

function ThemeControl() {
  const { preference, cycle } = useTheme();
  const Icon = THEME_ICON[preference];
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      title={`Appearance: ${THEME_LABEL[preference]}. Click to change.`}
      aria-label={`Appearance: ${THEME_LABEL[preference]}. Click to change.`}
    >
      <Icon size={14} aria-hidden="true" />
      <span>{THEME_LABEL[preference]}</span>
    </button>
  );
}

function StatusCard({ icon, label, value }) {
  return (
    <div className="status-card">
      <span className="muted">
        {icon} {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function statusLabel(status) {
  switch (status) {
    case 'running':
      return 'Debating';
    case 'pending':
      return 'Starting';
    case 'converged':
      return 'Finished early';
    case 'completed':
      return 'Finished';
    case 'cancelled':
      return 'Stopped';
    case 'interrupted':
      return 'Interrupted';
    case 'lost':
      return 'Lost';
    case 'failed':
      return 'Failed';
    case 'idle':
      return 'Not started';
    default:
      return TERMINAL.has(status) ? status : status;
  }
}
