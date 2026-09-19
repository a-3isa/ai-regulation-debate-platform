// The live side of the debate page: the chart that moves while the council
// argues, and the small human touches that make waiting on a slow model feel
// like watching something happen rather than watching a spinner.
//
// WHY THIS DOES NOT USE THE ANALYTICS PAYLOAD
// The Analytics page renders `run.analytics`, which arrives once per round from
// the Week 4 service. That is the right source for anything quoted as a
// finding — it is the same engine that writes the committed report. It is the
// wrong source for a live chart: it lands a beat after the round, and only if
// the analytics service is reachable, so the chart would sit still through the
// whole round and then jump.
//
// The numbers here come straight off the `opinion` events, which the debate
// service emits the moment each snapshot is recorded. Same stances Week 4
// reads — just earlier, and without a second service in the path. Nothing here
// is presented as a Week 4 metric.

import React, { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useAgentColors } from './AgentColorContext.jsx';
import { fmt, prettyName } from './Analytics.jsx';
import { displayName, stanceWord } from './Stage.jsx';

// --- live opinion trajectory ----------------------------------------------

/**
 * Stance per member per round, updating as the rounds land.
 *
 * Interactive in the one way that earns its keep here: tapping a member
 * isolates their line. Members frequently hold near-identical positions —
 * which is itself the finding — and the lines then overlap into a single
 * stripe. Being able to pull one out is the difference between a chart you
 * read and a chart you look at.
 */
export function LiveTrajectory({ run }) {
  const { colorFor, dashFor } = useAgentColors();
  const [isolated, setIsolated] = useState(null);

  const agents = run.meta?.agents || [];
  const personas = run.personas || {};

  const data = useMemo(() => {
    const rounds = new Set();
    agents.forEach((agent) =>
      (run.opinions[agent] || []).forEach((snapshot) => {
        if (typeof snapshot.round === 'number') rounds.add(snapshot.round);
      })
    );
    return [...rounds]
      .sort((a, b) => a - b)
      .map((round) => {
        const row = { round };
        agents.forEach((agent) => {
          const snapshot = (run.opinions[agent] || []).find((s) => s.round === round);
          if (typeof snapshot?.stance_score === 'number') row[agent] = snapshot.stance_score;
        });
        return row;
      });
  }, [run.opinions, agents]);

  if (data.length === 0) {
    return (
      <p className="empty">
        The council is reading the evidence. Opening positions land here first.
      </p>
    );
  }

  return (
    <>
      <div className="chart-legend">
        {agents.map((agent) => {
          const on = isolated === agent;
          return (
            <button
              key={agent}
              type="button"
              className={isolated && !on ? 'legend-chip dimmed' : 'legend-chip'}
              aria-pressed={on}
              onClick={() => setIsolated(on ? null : agent)}
              title={on ? 'Show everyone again' : `Show only ${displayName(personas, agent)}`}
            >
              <span className="sw" style={{ background: colorFor(agent) }} aria-hidden="true" />
              {displayName(personas, agent).split(' ').slice(-1)[0]}
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={230}>
        <LineChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -24 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} strokeDasharray="2 4" />
          <XAxis
            dataKey="round"
            stroke="var(--ink-4)"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--ink-4)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
          />
          <YAxis
            domain={[-2, 2]}
            ticks={[-2, 0, 2]}
            stroke="var(--ink-4)"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--ink-4)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
          />
          <ReferenceLine y={0} stroke="var(--line-strong)" />
          <Tooltip
            contentStyle={{
              background: 'var(--surface)',
              border: 'none',
              boxShadow: 'var(--e-3)',
              borderRadius: 'var(--r-2)',
              fontSize: 12,
              padding: '8px 12px',
            }}
            labelFormatter={(round) => `Round ${round}`}
            formatter={(value, key) => [fmt(value), displayName(personas, key)]}
          />
          {agents.map((agent) => {
            const dimmed = isolated && isolated !== agent;
            return (
              <Line
                key={agent}
                type="monotone"
                dataKey={agent}
                stroke={colorFor(agent)}
                strokeDasharray={dashFor(agent) || undefined}
                strokeWidth={isolated === agent ? 3 : 2.2}
                strokeOpacity={dimmed ? 0.14 : 1}
                dot={{ r: 2.5, strokeWidth: 0, fill: colorFor(agent) }}
                isAnimationActive
                animationDuration={520}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>

      <div className="chart-foot">
        <span>&minus;2 strongly against · +2 strongly for</span>
        <span>{isolated ? 'Tap again to show everyone' : 'Tap a name to follow one member'}</span>
      </div>
    </>
  );
}

// --- progress -------------------------------------------------------------

/** Round progress as ticks, so "round 3 of 5" is legible at a glance. */
export function RoundProgress({ current, total, finished }) {
  if (!total) return null;
  const rounds = Array.from({ length: total }, (_, index) => index + 1);
  return (
    <div className="progress-ticks" role="img" aria-label={`Round ${current} of ${total}`}>
      {rounds.map((round) => (
        <span
          key={round}
          style={{ width: `${Math.max(14, 120 / total)}px` }}
          className={round < current || finished ? 'done' : round === current ? 'now' : undefined}
        />
      ))}
    </div>
  );
}

// --- what is happening right now ------------------------------------------

//: Shown while a member composes. A model can take a minute, and one frozen
//: line of text for that whole minute reads as a hang. These rotate, so the
//: page is visibly alive — and each describes something the agent genuinely
//: does during a turn, so it stays honest rather than decorative.
const THINKING = [
  'is reading the room',
  'is weighing the evidence',
  'is checking the Act',
  'is choosing their words',
  'is looking for a precedent',
  'is drafting a reply',
];

export function NowSpeaking({ run }) {
  const personas = run.personas || {};
  const [phrase, setPhrase] = useState(0);
  const speaking = run.speaking;

  useEffect(() => {
    if (!speaking) return undefined;
    setPhrase(0);
    const timer = setInterval(() => setPhrase((p) => (p + 1) % THINKING.length), 4200);
    return () => clearInterval(timer);
  }, [speaking]);

  const lastMessage = run.messages[run.messages.length - 1];

  if (speaking) {
    return (
      <>
        <strong>{displayName(personas, speaking)}</strong>
        <span className="muted"> {THINKING[phrase]}…</span>
      </>
    );
  }

  if (lastMessage) {
    return (
      <>
        <strong>{displayName(personas, lastMessage.sender)}</strong>
        <span className="muted">
          {' '}
          answered {lastMessage.recipients.map((r) => displayName(personas, r)).join(', ')}
        </span>
      </>
    );
  }

  return <span className="muted">The council is settling in.</span>;
}

// --- the closing band -----------------------------------------------------

/**
 * The verdict when a run ends.
 *
 * Not decoration: "converged" and "completed" are genuinely different outcomes,
 * and the difference used to be buried in a status chip reading "Finished
 * early". Saying which one happened, in a sentence, with the numbers that
 * justify it, is the most useful thing this page can do at the moment it stops
 * moving.
 */
export function ClosingBand({ run }) {
  const { colorFor } = useAgentColors();
  const finished = ['completed', 'converged', 'cancelled'].includes(run.status);
  if (!finished) return null;

  const personas = run.personas || {};
  const agents = run.meta?.agents || [];

  const finals = agents
    .map((agent) => {
      const history = run.opinions[agent] || [];
      const first = history[0]?.stance_score;
      const last = history[history.length - 1]?.stance_score;
      return typeof last === 'number'
        ? { agent, first, last, moved: typeof first === 'number' ? last - first : null }
        : null;
    })
    .filter(Boolean);

  const stances = finals.map((f) => f.last);
  const spread = stances.length > 1 ? Math.max(...stances) - Math.min(...stances) : null;
  const movers = finals.filter((f) => f.moved !== null && Math.abs(f.moved) > 0.01);
  const biggest = movers.length
    ? movers.reduce((a, b) => (Math.abs(b.moved) > Math.abs(a.moved) ? b : a))
    : null;

  const agreement = (run.analytics?.agreement || []).filter((p) => typeof p.score === 'number');
  const closedAt = agreement.length ? agreement[agreement.length - 1].score : null;

  let headline;
  if (run.status === 'cancelled') {
    headline = 'Stopped mid-session. Everything said up to that point is kept, and the report covers it.';
  } else if (run.status === 'converged') {
    headline = 'They ran out of disagreement. Positions stopped moving, so the session closed before the last round.';
  } else if (!movers.length) {
    headline = 'Nobody moved. The debate hardened four existing positions rather than changing any of them.';
  } else if (spread !== null && spread < 0.6) {
    headline = `They ended up close together — less than ${spread.toFixed(2)} of stance separates the whole council.`;
  } else if (spread !== null && spread > 2.5) {
    headline = `They held their ground. The council finished ${spread.toFixed(2)} apart on a four-point scale.`;
  } else {
    headline = 'The session closed with the room partly moved and partly dug in.';
  }

  return (
    <section className="closing-band" role="status">
      <div className="verdict">
        <div className="kicker" style={{ marginBottom: 'var(--s-2)' }}>Where it landed</div>
        <p>{headline}</p>
      </div>
      <div className="final-stats">
        {biggest && (
          <div className="final-stat">
            <div className="v">
              <span className="sw" style={{ background: colorFor(biggest.agent) }} aria-hidden="true" />
              {biggest.moved > 0 ? '+' : '−'}
              {Math.abs(biggest.moved).toFixed(2)}
            </div>
            <div className="l">
              furthest move — {displayName(personas, biggest.agent).split(' ').slice(-1)[0]}
            </div>
          </div>
        )}
        <div className="final-stat">
          <div className="v">{movers.length}/{finals.length}</div>
          <div className="l">members who shifted at all</div>
        </div>
        {closedAt !== null && (
          <div className="final-stat">
            <div className="v">{closedAt.toFixed(2)}</div>
            <div className="l">agreement at close</div>
          </div>
        )}
        {spread !== null && (
          <div className="final-stat">
            <div className="v">{spread.toFixed(2)}</div>
            <div className="l">spread across the room</div>
          </div>
        )}
      </div>
    </section>
  );
}

export { prettyName, stanceWord };
