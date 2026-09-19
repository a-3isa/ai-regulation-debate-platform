// Shell: masthead, navigation, and hash routing.
//
// Routing is hash-based on purpose — the UI is served as static files behind
// Traefik, and a hash route needs no server-side rewrite rules to survive a
// refresh or a shared link.
//
// The whole tree sits inside an AgentColorProvider seeded from the union of
// "members on file" and "members seated in this run", so one member is one
// identity everywhere: the composer chips, the ring, the transcript, all four
// charts, and the PNGs in the exported report.

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { AgentColorProvider } from './AgentColorContext.jsx';
import { listPersonas } from './api.js';
import { MembersPage } from './Members.jsx';
import { AboutPage, AnalyticsPage, ArchivePage, ChamberPage, RecordPage } from './Pages.jsx';
import { useTheme } from './theme.js';
import { TERMINAL, useDebateRun } from './useDebateRun.js';

const PAGES = [
  { id: 'debate', label: 'Debate' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'report', label: 'Report' },
  { id: 'members', label: 'Members' },
  { id: 'history', label: 'History' },
  { id: 'about', label: 'About' },
];

const THEME_OPTIONS = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'Auto' },
];

function currentPage() {
  const id = window.location.hash.replace(/^#\/?/, '');
  return PAGES.some((p) => p.id === id) ? id : 'debate';
}

export default function App() {
  const { run, charts, starting, running, start, stop, attach } = useDebateRun();
  const [page, setPage] = useState(currentPage);
  const [members, setMembers] = useState([]);

  const loadMembers = useCallback(() => {
    listPersonas().then(setMembers).catch(() => {});
  }, []);

  useEffect(() => { loadMembers(); }, [loadMembers]);

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

  // Every id the identity registry should know about. A debate opened from the
  // archive can name a member that has since been deleted, so the run's own
  // agent list has to be in here as well as the current roster.
  const colorIds = useMemo(
    () => [...new Set([...members.map((m) => m.id), ...(run.meta?.agents || [])])],
    [members, run.meta]
  );

  return (
    <AgentColorProvider ids={colorIds}>
      <div className="app">
        <a className="skip-link" href="#content">Skip to content</a>

        <header className="masthead">
          <div className="masthead-inner">
            <div className="wordmark">
              <strong>Forum</strong>
              <span className="run-id">{run.runId ? run.runId.slice(0, 8) : 'draft'}</span>
            </div>

            <nav aria-label="Sections">
              <ul className="nav">
                {PAGES.map(({ id, label }) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => go(id)}
                      className={page === id ? 'nav-item active' : 'nav-item'}
                      aria-current={page === id ? 'page' : undefined}
                    >
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            <ThemeSwitch />
          </div>
        </header>

        {run.slow && running && (
          <div className="shell">
            <p className="banner warn" role="status">
              Still working — the model is taking longer than usual on this turn. The debate is
              running on the server.
            </p>
          </div>
        )}

        {run.meta?.llm_stubbed && (
          <div className="shell">
            <p className="banner warn" role="status">
              The model is switched off — members are returning placeholder text, not real arguments.
            </p>
          </div>
        )}

        {run.error && (
          <div className="shell">
            <p
              className={run.status === 'interrupted' || run.status === 'lost' ? 'banner warn' : 'banner error'}
              role="alert"
            >
              {run.error}
            </p>
          </div>
        )}

        <main id="content" className="shell">
          {page === 'debate' && (
            <ChamberPage
              run={run}
              members={members}
              running={running}
              starting={starting}
              onStart={start}
              onStop={stop}
              onManageMembers={() => go('members')}
              onOpenAnalytics={() => go('analytics')}
              onOpenReport={() => go('report')}
            />
          )}
          {page === 'analytics' && <AnalyticsPage run={run} />}
          {page === 'report' && <RecordPage run={run} charts={charts} />}
          {page === 'members' && <MembersPage debating={running} />}
          {page === 'history' && (
            <ArchivePage
              currentRunId={run.runId}
              onOpen={(runId) => {
                attach(runId);
                go('debate');
              }}
            />
          )}
          {page === 'about' && <AboutPage />}
        </main>

        <footer className="foot">
          Week 1 retrieval → Week 2 personas → Week 3 discussion → Week 4 analytics.
          {run.analytics?.sentiment_backend && <> Tone scored with {run.analytics.sentiment_backend}.</>}
        </footer>
      </div>
    </AgentColorProvider>
  );
}

/** Three states, not a toggle — "follow the system" is a real choice. */
function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  return (
    <div className="theme-switch" role="group" aria-label="Appearance">
      {THEME_OPTIONS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={preference === id}
          onClick={() => setPreference(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function statusLabel(status) {
  switch (status) {
    case 'running': return 'In session';
    case 'pending': return 'Opening the floor';
    case 'converged': return 'Closed early';
    case 'completed': return 'Closed';
    case 'cancelled': return 'Stopped';
    case 'interrupted': return 'Interrupted';
    case 'lost': return 'Lost';
    case 'failed': return 'Failed';
    case 'idle': return 'Not started';
    default: return TERMINAL.has(status) ? status : status;
  }
}
