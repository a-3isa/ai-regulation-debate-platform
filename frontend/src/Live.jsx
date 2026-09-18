// The live side of the debate page: a chart that moves while the council
// argues, and the small human touches that make waiting on a slow model feel
// like watching something happen rather than watching a spinner.
//
// WHY THIS DOES NOT USE THE ANALYTICS PAYLOAD
// The Analytics page renders `run.analytics`, which arrives once per round from
// the Week 4 service. That is the right source for anything quoted as a
// finding - it is the same engine that writes the committed report. But it is
// the wrong source for a live chart: it lands a beat after the round, and only
// if the analytics service is reachable, so the chart would sit still through
// the whole round and then jump.
//
// The numbers here come straight off the `opinion` events instead, which the
// debate service emits the moment each snapshot is recorded. Same stances -
// `stance_score` is what Week 4's `opinion_change` reads - just earlier and
// without a second service in the path. Nothing here is presented as a Week 4
// metric: this is the debate moving, and the Analytics and Report pages remain
// the place where measured numbers live.

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { Activity, Sparkles } from 'lucide-react';

import { useAgentColors } from './AgentColorContext.jsx';
import { prettyName } from './Analytics.jsx';
import { displayName } from './Stage.jsx';

// --- live opinion trajectory ----------------------------------------------

/**
 * Stance per member per round, updating as the rounds land.
 *
 * Interactive in the one way that earns its keep here: clicking a member
 * isolates their line. With four members holding near-identical positions -
 * which is common, and is itself the finding - the lines overlap into a single
 * stripe, and being able to pull one out is the difference between a chart you
 * read and a chart you look at.
 */
export function LiveTrajectory({ run }) {
  const { colorFor } = useAgentColors();
  const [isolated, setIsolated] = useState(null);

  const agents = run.meta?.agents || [];
  const personas = run.personas || {};

  const data = useMemo(() => {
    // Round numbers actually seen, so the x-axis grows with the debate rather
    // than showing empty space for rounds that have not happened.
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
      <p className="muted empty">
        The council is reading the evidence. Their opening positions will appear here.
      </p>
    );
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -24 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="round"
            stroke="var(--axis)"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--axis)', fontSize: 10 }}
          />
          <YAxis
            domain={[-2, 2]}
            ticks={[-2, 0, 2]}
            stroke="var(--axis)"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--axis)', fontSize: 10 }}
          />
          <ReferenceLine y={0} stroke="var(--axis)" strokeDasharray="3 3" />
          <Tooltip
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--line-strong)',
              borderRadius: 12,
              fontSize: 12,
              padding: '8px 12px',
            }}
            labelFormatter={(round) => `Round ${round}`}
            formatter={(value, key) => [value.toFixed(2), displayName(personas, key)]}
          />
          {agents.map((agent) => {
            const dimmed = isolated && isolated !== agent;
            return (
              <Line
                key={agent}
                type="monotone"
                dataKey={agent}
                stroke={colorFor(agent)}
                strokeWidth={isolated === agent ? 3 : 2}
                strokeOpacity={dimmed ? 0.15 : 1}
                dot={{ r: 2, strokeWidth: 0, fill: colorFor(agent) }}
                // New rounds animate in; that movement is the point of the
                // panel, and it is disabled with the rest under
                // prefers-reduced-motion by the CSS.
                isAnimationActive
                animationDuration={600}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>

      <div className="chips live-legend">
        {agents.map((agent) => {
          const on = isolated === agent;
          return (
            <button
              key={agent}
              type="button"
              className={on ? 'chip-toggle on' : 'chip-toggle'}
              style={{ '--who': colorFor(agent) }}
              aria-pressed={on}
              onClick={() => setIsolated(on ? null : agent)}
              title={on ? 'Show everyone again' : `Show only ${displayName(personas, agent)}`}
            >
              <span className="swatch" style={{ background: colorFor(agent) }} aria-hidden="true" />
              {displayName(personas, agent).split(' ').slice(-1)[0]}
            </button>
          );
        })}
      </div>
      <p className="muted small chart-note">
        Updated the moment each round lands. Tap a name to follow one member.
        {isolated && ' Tap again to show everyone.'}
      </p>
    </>
  );
}

// --- how far along are we -------------------------------------------------

/** Round progress as dots, so "round 3 of 5" is legible at a glance. */
export function RoundProgress({ current, total, finished }) {
  if (!total) return null;
  const rounds = Array.from({ length: total }, (_, index) => index + 1);
  return (
    <div className="round-progress" role="img" aria-label={`Round ${current} of ${total}`}>
      {rounds.map((round) => (
        <span
          key={round}
          className={
            round < current || finished ? 'tick done' : round === current ? 'tick now' : 'tick'
          }
        />
      ))}
    </div>
  );
}

// --- what is happening right now ------------------------------------------

//: Shown while a member is composing. A model can take a minute, and one
//: frozen line of text for that whole minute reads as a hang; these rotate, so
//: the page is visibly alive and honest about what it is doing. Each one
//: describes something the agent genuinely does during a turn.
const THINKING = [
  'is reading the room',
  'is weighing the evidence',
  'is choosing their words',
  'is checking the Act',
  'is drafting a reply',
  'is looking for a precedent',
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
      <p className="now-speaking">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <strong>{displayName(personas, speaking)}</strong> {THINKING[phrase]}…
      </p>
    );
  }

  if (lastMessage) {
    return (
      <p className="now-speaking quiet">
        <Activity size={13} aria-hidden="true" />
        <strong>{displayName(personas, lastMessage.sender)}</strong> just answered{' '}
        {lastMessage.recipients.map((r) => displayName(personas, r)).join(', ')}.
      </p>
    );
  }

  return (
    <p className="now-speaking quiet">
      <Activity size={13} aria-hidden="true" /> The council is settling in.
    </p>
  );
}

// --- the closing note -----------------------------------------------------

/**
 * A plain-language verdict when the debate ends.
 *
 * Not a decoration: "converged" and "completed" are two genuinely different
 * outcomes, and the distinction was previously buried in a status chip reading
 * "Finished early". Saying which one happened, in a sentence, is the most
 * useful thing this page can do at the moment it stops moving.
 */
export function ClosingNote({ run }) {
  const finished = ['completed', 'converged', 'cancelled'].includes(run.status);
  if (!finished) return null;

  const stances = Object.entries(run.opinions)
    .map(([agent, history]) => history[history.length - 1]?.stance_score)
    .filter((value) => typeof value === 'number');

  const spread = stances.length > 1 ? Math.max(...stances) - Math.min(...stances) : null;

  let headline;
  let detail;
  if (run.status === 'cancelled') {
    headline = 'Stopped mid-session';
    detail = 'Everything said up to that point is kept, and the report covers it.';
  } else if (run.status === 'converged') {
    headline = 'They found common ground';
    detail = 'Positions stopped moving, so the session closed before the last round.';
  } else if (spread !== null && spread < 0.5) {
    headline = 'They ended up close together';
    detail = `Less than ${spread.toFixed(2)} of stance separates the whole council.`;
  } else if (spread !== null && spread > 2.5) {
    headline = 'They held their ground';
    detail = `The council finished ${spread.toFixed(2)} apart on the −2 to +2 scale.`;
  } else {
    headline = 'The session is closed';
    detail = 'Every round was heard.';
  }

  return (
    <section className="closing-note" role="status">
      <Sparkles size={17} aria-hidden="true" />
      <div>
        <strong>{headline}</strong>
        <p className="muted small">
          {detail} The <a href="#/report">report</a> has the closing exchange and the findings.
        </p>
      </div>
    </section>
  );
}

export { prettyName };
