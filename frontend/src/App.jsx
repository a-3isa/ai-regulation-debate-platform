// Shell: the masthead, the motion (topic) form, the nav, and hash routing.
//
// Routing is hash-based on purpose - the UI is served as static files behind
// Traefik, and a hash route needs no server-side rewrite rules to survive a
// refresh or a shared link.

import React, { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Gavel,
  Info,
  Loader2,
  Play,
  ScrollText,
  Square,
  Users,
} from 'lucide-react';

import { AboutPage, AnalyticsPage, ArchivePage, ChamberPage, RecordPage } from './Pages.jsx';
import { TERMINAL, useDebateRun } from './useDebateRun.js';

const PAGES = [
  { id: 'chamber', label: 'Chamber', icon: Gavel },
  { id: 'analysis', label: 'Analysis', icon: BarChart3 },
  { id: 'record', label: 'Record', icon: ScrollText },
  { id: 'archive', label: 'Archive', icon: Users },
  { id: 'about', label: 'About', icon: Info },
];

function currentPage() {
  const id = window.location.hash.replace(/^#\/?/, '');
  return PAGES.some((p) => p.id === id) ? id : 'chamber';
}

export default function App() {
  const { run, charts, starting, running, start, stop, attach } = useDebateRun();
  const [page, setPage] = useState(currentPage);
  const [topic, setTopic] = useState('');
  const [numRounds, setNumRounds] = useState(4);
  const [strategy, setStrategy] = useState('ring');

  useEffect(() => {
    const onHashChange = () => setPage(currentPage());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Send the viewer to the record as soon as a debate closes: that is what
  // they are waiting for, and it is two clicks away otherwise.
  useEffect(() => {
    if (TERMINAL.has(run.status) && run.status !== 'failed' && page === 'chamber' && run.report) {
      // Announce rather than hijack - a link, not a redirect.
      setPage('chamber');
    }
  }, [run.status, run.report, page]);

  function go(id) {
    window.location.hash = `#/${id}`;
    setPage(id);
  }

  function onSubmit(event) {
    event.preventDefault();
    start({ topic, numRounds, strategy });
    go('chamber');
  }

  function openArchived(runId) {
    attach(runId);
    go('chamber');
  }

  const roundsSeen = run.meta?.num_rounds ?? numRounds;

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>

      <header className="masthead">
        <div className="crest">
          <Gavel size={22} aria-hidden="true" />
          <div>
            <h1>The AI Regulation Council</h1>
            <p className="muted small">A standing chamber on artificial-intelligence policy</p>
          </div>
        </div>

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
                  <Icon size={15} aria-hidden="true" /> {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <form className="motion-form" onSubmit={onSubmit}>
        <label className="grow">
          <span>Motion before the council</span>
          <input
            type="text"
            value={topic}
            maxLength={300}
            placeholder="e.g. open-source foundation models should be exempt from high-risk obligations"
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
          <span>Seating</span>
          <select value={strategy} onChange={(event) => setStrategy(event.target.value)} disabled={running}>
            <option value="ring">Ring — each hears one</option>
            <option value="mesh">Mesh — each hears all</option>
          </select>
        </label>
        {running ? (
          <button type="button" className="danger" onClick={stop}>
            <Square size={15} aria-hidden="true" /> Adjourn
          </button>
        ) : (
          <button type="submit" disabled={!topic.trim() || starting}>
            {starting ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            {starting ? 'Convening…' : 'Open the session'}
          </button>
        )}
      </form>

      {run.runId && (
        <section className="status-strip" aria-label="Session status">
          <StatusCard icon={<Activity size={14} />} label="Session" value={statusLabel(run.status)} />
          <StatusCard
            icon={<Gavel size={14} />}
            label="Round"
            value={`${Math.min(run.currentRound, roundsSeen)} of ${roundsSeen}`}
          />
          <StatusCard icon={<ScrollText size={14} />} label="Speeches" value={String(run.messages.length)} />
          <StatusCard icon={<BarChart3 size={14} />} label="Sources cited" value={String(run.retrievals.length)} />
        </section>
      )}

      {run.meta?.llm_stubbed && (
        <p className="banner warn" role="status">
          The language model is stubbed — members are returning placeholder text, not real argument.
        </p>
      )}

      {run.error && (
        <p className="banner error" role="alert">
          {run.error}
        </p>
      )}

      <main id="main">
        {page === 'chamber' && <ChamberPage run={run} />}
        {page === 'analysis' && <AnalyticsPage run={run} />}
        {page === 'record' && <RecordPage run={run} charts={charts} />}
        {page === 'archive' && <ArchivePage onOpen={openArchived} currentRunId={run.runId} />}
        {page === 'about' && <AboutPage />}
      </main>

      <footer className="foot muted small">
        Week 1 retrieval → Week 2 personas → Week 3 discussion → Week 4 analytics.
        {run.analytics?.sentiment_backend && <> Tone scored with {run.analytics.sentiment_backend}.</>}
      </footer>
    </div>
  );
}

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

function statusLabel(status) {
  if (status === 'converged') return 'closed early';
  if (status === 'running') return 'in session';
  if (status === 'pending') return 'convening';
  if (status === 'idle') return 'not sitting';
  return status;
}
