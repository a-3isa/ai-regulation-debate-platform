// The pages behind the nav. Each one reads from the same run object, so moving
// between them never interrupts a debate in progress.

import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  AlertTriangle,
  BookOpen,
  Download,
  ExternalLink,
  FileText,
  Gavel,
  Handshake,
  LineChart,
  Network,
  Radio,
  ScrollText,
  Smile,
  TrendingUp,
  Users,
} from 'lucide-react';

import {
  AgreementTrend,
  Empty,
  InfluenceRanking,
  OpinionTrajectory,
  SentimentPanel,
  prettyName,
} from './Analytics.jsx';
import { ClosingNote, LiveTrajectory, NowSpeaking, RoundProgress } from './Live.jsx';
import { ChamberRing, Floor, MemberCard, RoleIcon, Seat, displayName } from './Stage.jsx';
import { API_BASE, discussionUrl } from './api.js';

// --- chamber (live debate) ------------------------------------------------

export function ChamberPage({ run, members }) {
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

  if (run.status === 'idle') return <Welcome members={members} />;

  return (
    <div className="chamber">
      <ClosingNote run={run} />

      <section className="panel chamber-stage">
        <div className="stage-head">
          <h2>
            <Gavel size={17} aria-hidden="true" /> Who is talking to whom
          </h2>
          <p className="muted small motion">{run.meta?.topic}</p>
          <RoundProgress
            current={run.currentRound}
            total={totalRounds}
            finished={finished}
          />
          <NowSpeaking run={run} />
        </div>
        <ChamberRing
          agents={agents}
          personas={personas}
          graph={run.meta?.graph}
          speaking={run.speaking}
          lastMessage={lastMessage}
          stances={stances}
        />
        <p className="muted small ring-note">
          Arrows show who hears whom. The number is how much the speaker values the listener's
          point of view (0 to 1).
        </p>
      </section>

      <section className="roster">
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
              speaking={run.speaking === agent}
            />
          );
        })}
      </section>

      <section className="panel live-panel">
        <h2>
          <TrendingUp size={17} aria-hidden="true" /> Positions, as they move
        </h2>
        <LiveTrajectory run={run} />
      </section>

      <section className="panel floor-panel">
        <h2>
          <ScrollText size={17} aria-hidden="true" /> Conversation
        </h2>
        <Floor run={run} personas={personas} />
      </section>
    </div>
  );
}

function Welcome({ members }) {
  return (
    <section className="panel welcome">
      <h2>
        <Gavel size={18} aria-hidden="true" /> The council is seated
      </h2>
      <p>
        Give them something to argue about. Each member reads the AI-regulation evidence, takes a
        position, and then spends the rounds you choose trying to move everybody else — looking up
        sources when someone demands proof.
      </p>
      {members?.length > 0 ? (
        <>
          <p className="muted small welcome-label">
            <Users size={13} aria-hidden="true" /> Today's council
          </p>
          <ul className="member-preview">
            {members.map((member) => (
              <li key={member.id}>
                <Seat personaId={member.id} personas={{ [member.id]: member }} size="sm" />
                <div>
                  <strong>{member.name}</strong>
                  <span className="muted small role">
                    <RoleIcon personaId={member.id} size={12} /> {member.role}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted small">Gathering the council…</p>
      )}
      <p className="muted small">
        Swap the members out on the <a href="#/members">Members</a> page. Every number the
        Analytics page shows is measured by the Week 4 engine from what was actually said — nothing
        on this site is decorative.
      </p>
    </section>
  );
}

// --- analytics ------------------------------------------------------------

export function AnalyticsPage({ run }) {
  if (!run.analytics) {
    return (
      <section className="panel">
        <h2>Analytics</h2>
        <Empty
          label={
            'Measured charts appear once the first round finishes. The Debate page has a live ' +
            'view of the positions in the meantime.'
          }
        />
      </section>
    );
  }

  return (
    <div className="grid-2">
      <section className="panel">
        <h2>
          <TrendingUp size={17} aria-hidden="true" /> Opinion trajectory
        </h2>
        <OpinionTrajectory analytics={run.analytics} />
        <p className="muted small chart-note">
          Stance runs from −2, strongly against, to +2, strongly for.
        </p>
      </section>
      <section className="panel">
        <h2>
          <Handshake size={17} aria-hidden="true" /> Agreement per round
        </h2>
        <AgreementTrend analytics={run.analytics} />
        <p className="muted small chart-note">1.00 means everyone holds the same position.</p>
      </section>
      <section className="panel">
        <h2>
          <Radio size={17} aria-hidden="true" /> Influence
        </h2>
        <InfluenceRanking analytics={run.analytics} />
      </section>
      <section className="panel">
        <h2>
          <Smile size={17} aria-hidden="true" /> Sentiment
        </h2>
        <SentimentPanel analytics={run.analytics} messages={run.messages} />
      </section>

      {run.retrievals.length > 0 && (
        <section className="panel span-2">
          <h2>
            <BookOpen size={17} aria-hidden="true" /> Evidence used
          </h2>
          <ul className="evidence">
            {run.retrievals.slice().reverse().map((event, index) => (
              <li key={`${event.persona_id}-${event.round}-${index}`}>
                <strong>{prettyName(event.persona_id)}</strong>
                <span className="muted"> · round {event.round} · {event.source} · {event.result_count} result
                  {event.result_count === 1 ? '' : 's'}</span>
                <em>“{event.query}”</em>
              </li>
            ))}
          </ul>
        </section>
      )}

      {run.notices.length > 0 && (
        <section className="panel span-2 warn">
          <h2>
            <AlertTriangle size={17} aria-hidden="true" /> Notices
          </h2>
          <ul>
            {run.notices.map((notice, index) => (
              <li key={index}>{notice}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// --- record (report + charts + downloads) ---------------------------------

export function RecordPage({ run, charts }) {
  const finished = ['completed', 'converged', 'cancelled'].includes(run.status);

  if (!finished) {
    return (
      <section className="panel">
        <h2>Report</h2>
        <Empty label="The written report is ready the moment the council finishes." />
      </section>
    );
  }

  const reportHref = run.report
    ? URL.createObjectURL(new Blob([run.report], { type: 'text/markdown' }))
    : null;
  const analyticsHref = run.analytics
    ? URL.createObjectURL(
        new Blob([JSON.stringify(run.analytics, null, 2)], { type: 'application/json' })
      )
    : null;

  return (
    <div className="record">
      <div className="grid-2">
        <section className="panel">
          <h2>
            <LineChart size={17} aria-hidden="true" /> Opinion trajectory
          </h2>
          {charts?.opinion_trajectory_png ? (
            <img alt="Opinion trajectory chart" src={`data:image/png;base64,${charts.opinion_trajectory_png}`} />
          ) : (
            <Empty label="Chart unavailable." />
          )}
        </section>
        <section className="panel">
          <h2>
            <Network size={17} aria-hidden="true" /> Interaction graph
          </h2>
          {charts?.interaction_graph_png ? (
            <img alt="Interaction graph" src={`data:image/png;base64,${charts.interaction_graph_png}`} />
          ) : (
            <Empty label="Graph unavailable." />
          )}
        </section>
      </div>

      <section className="panel">
        <h2>
          <FileText size={17} aria-hidden="true" /> Report
        </h2>
        {run.report ? (
          <div className="markdown">
            <ReactMarkdown>{run.report}</ReactMarkdown>
          </div>
        ) : (
          <Empty label="Report unavailable." />
        )}
      </section>

      <section className="panel downloads">
        <h2>
          <Download size={17} aria-hidden="true" /> Downloads
        </h2>
        <div className="download-row">
          {reportHref && (
            <a className="button" href={reportHref} download={`report_${run.meta?.discussion_id || run.runId}.md`}>
              report.md
            </a>
          )}
          {analyticsHref && (
            <a
              className="button"
              href={analyticsHref}
              download={`analytics_${run.meta?.discussion_id || run.runId}.json`}
            >
              analytics_result.json
            </a>
          )}
          <a className="button ghost" href={discussionUrl(run.runId)} target="_blank" rel="noreferrer">
            transcript JSON <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
      </section>
    </div>
  );
}

// --- archive --------------------------------------------------------------

export function ArchivePage({ onOpen, currentRunId }) {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/runs`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status}`))))
      .then((body) => setRuns(body.runs || []))
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <section className="panel warn">Could not load the archive: {error}</section>;
  if (!runs) return <section className="panel"><Empty label="Looking up past sessions…" /></section>;
  if (!runs.length)
    return (
      <section className="panel">
        <Empty label="No debates on record yet — start one and it will be kept here." />
      </section>
    );

  return (
    <section className="panel">
      <h2>
        <ScrollText size={17} aria-hidden="true" /> Past debates
      </h2>
      <p className="muted small">
        Saved on the server - including debates that were interrupted before they finished.
      </p>
      <table className="archive">
        <thead>
          <tr>
            <th scope="col">Topic</th>
            <th scope="col">Status</th>
            <th scope="col">Rounds</th>
            <th scope="col">Started</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {runs.slice().reverse().map((entry) => (
            <tr key={entry.run_id} className={entry.run_id === currentRunId ? 'current' : undefined}>
              <td>{entry.topic}</td>
              <td>
                <span className={`chip ${entry.status}`}>{entry.status}</span>
              </td>
              <td className="num">{entry.num_rounds}</td>
              <td className="muted small">{new Date(entry.started_at).toLocaleString()}</td>
              <td>
                <button type="button" className="ghost small-button" onClick={() => onOpen(entry.run_id)}>
                  Open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// --- about ----------------------------------------------------------------

export function AboutPage() {
  const links = [
    ['Debate API (OpenAPI)', `${API_BASE}/docs`, 'Start runs, follow the stream, fetch reports and charts.'],
    ['Analytics API (OpenAPI)', `${API_BASE.replace(/\/api$/, '')}/analytics/docs`, 'The Week 4 engine: metrics, report, visualizations.'],
    ['Service health', `${API_BASE}/health`, 'Liveness, and whether the analytics service is reachable.'],
    ['Discussions on file', `${API_BASE}/discussions`, 'Every transcript the analytics service can read.'],
  ];

  const repos = [
    ['Week 1 — knowledge base', 'https://github.com/a-3isa/week1-ai-regulation-pipeline'],
    ['Week 2 — agent framework', 'https://github.com/a-3isa/Intelligent-Agent-Framework'],
    ['Week 3 — discussion engine', 'https://github.com/a-3isa/Multi-Agent-Collaboration-AI-Regulation-Team_A'],
    ['Week 4 — analytics layer', 'https://github.com/YaassminSalahEldin/Analytics-Intelligence-Layer'],
  ];

  return (
    <div className="grid-2">
      <section className="panel">
        <h2>How a debate works</h2>
        <ol className="steps">
          <li><strong>Opening positions.</strong> Each member forms a view from the Week 1 evidence, scored from −2 (against) to +2 (for).</li>
          <li><strong>Rounds.</strong> Members take turns; each replies to the member they are connected to.</li>
          <li><strong>Evidence.</strong> When challenged, a member looks up sources during the debate.</li>
          <li><strong>Analytics.</strong> After every round, the Week 4 engine measures opinion change, agreement, influence and sentiment.</li>
          <li><strong>Report.</strong> At the end: a written report, both charts, and the full transcript.</li>
        </ol>
      </section>

      <section className="panel">
        <h2>Service endpoints</h2>
        <ul className="link-list">
          {links.map(([label, href, note]) => (
            <li key={href}>
              <a href={href} target="_blank" rel="noreferrer">
                {label} <ExternalLink size={13} aria-hidden="true" />
              </a>
              <span className="muted small block">{note}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel span-2">
        <h2>Source</h2>
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
  );
}
