// Week 4 analytics, rendered live from the `analytics` stream events.
//
// Every number here comes from the Week 4 engine over the wire - nothing is
// recomputed in the browser, so the dashboard and the committed report can
// never disagree.

import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export const AGENT_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#22d3ee'];

export function agentColor(index) {
  return AGENT_COLORS[index % AGENT_COLORS.length];
}

export function prettyName(id) {
  return (id || '').replace(/_/g, ' ');
}

// --- opinion trajectory ----------------------------------------------------

export function OpinionTrajectory({ analytics }) {
  const series = analytics?.opinion_change || {};
  const agents = Object.keys(series);
  if (!agents.length) return <Empty label="Opinion trajectories appear after round 0." />;

  const rounds = series[agents[0]].map((point) => point.round);
  const data = rounds.map((round, index) => {
    const row = { round };
    agents.forEach((agent) => {
      const point = series[agent][index];
      if (point) row[agent] = point.stance;
    });
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="round" stroke="#94a3b8" tickLine={false} />
        <YAxis domain={[-2, 2]} ticks={[-2, -1, 0, 1, 2]} stroke="#94a3b8" tickLine={false} />
        <ReferenceLine y={0} stroke="#475569" />
        <Tooltip contentStyle={tooltipStyle} formatter={(value) => value?.toFixed?.(2) ?? value} />
        <Legend formatter={prettyName} />
        {agents.map((agent, index) => (
          <Line
            key={agent}
            type="monotone"
            dataKey={agent}
            stroke={agentColor(index)}
            strokeWidth={2.5}
            dot={{ r: 3 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// --- agreement -------------------------------------------------------------

export function AgreementTrend({ analytics }) {
  const points = (analytics?.agreement || []).filter((p) => typeof p.score === 'number');
  if (!points.length) return <Empty label="Agreement is scored once a round completes." />;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="round" stroke="#94a3b8" tickLine={false} />
        <YAxis domain={[0, 1]} stroke="#94a3b8" tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} formatter={(value) => value.toFixed(4)} />
        <Line
          type="monotone"
          dataKey="score"
          name="agreement"
          stroke="#34d399"
          strokeWidth={2.5}
          dot={{ r: 3 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// --- influence -------------------------------------------------------------

export function InfluenceRanking({ analytics }) {
  const raw = analytics?.influence || {};
  const scored = Object.entries(raw)
    .filter(([, value]) => typeof value === 'number')
    .map(([agent, score]) => ({ agent, score }))
    .sort((a, b) => b.score - a.score);
  const insufficient = Object.entries(raw).filter(([, value]) => typeof value !== 'number');

  if (!scored.length) {
    return (
      <Empty
        label={
          insufficient.length
            ? 'No agent has enough attributable interactions yet (insufficient_data).'
            : 'Influence is scored once opinions start moving.'
        }
      />
    );
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={Math.max(160, scored.length * 46)}>
        <BarChart data={scored} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
          <XAxis type="number" stroke="#94a3b8" tickLine={false} />
          <YAxis
            type="category"
            dataKey="agent"
            width={150}
            stroke="#94a3b8"
            tickLine={false}
            tickFormatter={prettyName}
          />
          <Tooltip contentStyle={tooltipStyle} formatter={(value) => value.toFixed(4)} />
          <Bar dataKey="score" radius={[0, 4, 4, 0]}>
            {scored.map((entry, index) => (
              <Cell key={entry.agent} fill={agentColor(index)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {insufficient.length > 0 && (
        <p className="muted small">
          insufficient_data: {insufficient.map(([agent]) => prettyName(agent)).join(', ')}
        </p>
      )}
      <p className="muted small">
        Association, not proof of causation: a stance move after reading an agent is consistent
        with, but not proof of, that agent causing it.
      </p>
    </>
  );
}

// --- sentiment -------------------------------------------------------------

export function SentimentPanel({ analytics, messages }) {
  const sentiment = analytics?.sentiment || [];
  if (!sentiment.length) return <Empty label="Sentiment is scored per message." />;

  const distribution = { positive: 0, neutral: 0, negative: 0 };
  sentiment.forEach((point) => {
    if (distribution[point.label] !== undefined) distribution[point.label] += 1;
  });

  const roundOf = new Map(messages.map((m) => [m.message_id, m.round]));
  const byRound = new Map();
  sentiment.forEach((point) => {
    const round = roundOf.get(point.message_id);
    if (round === undefined) return;
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round).push(point.score);
  });
  const trend = [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, scores]) => ({
      round,
      score: scores.reduce((sum, value) => sum + value, 0) / scores.length,
    }));

  const mean = sentiment.reduce((sum, point) => sum + point.score, 0) / sentiment.length;

  return (
    <>
      <div className="pill-row">
        <span className="pill positive">positive {distribution.positive}</span>
        <span className="pill neutral">neutral {distribution.neutral}</span>
        <span className="pill negative">negative {distribution.negative}</span>
        <span className="pill">mean {mean.toFixed(3)}</span>
        {analytics?.sentiment_backend && (
          <span className="pill muted-pill">scored with {analytics.sentiment_backend}</span>
        )}
      </div>
      {trend.length > 0 && (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={trend} margin={{ top: 8, right: 16, bottom: 4, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="round" stroke="#94a3b8" tickLine={false} />
            <YAxis domain={[-1, 1]} stroke="#94a3b8" tickLine={false} />
            <ReferenceLine y={0} stroke="#475569" />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => value.toFixed(3)} />
            <Line
              type="monotone"
              dataKey="score"
              name="mean tone"
              stroke="#fbbf24"
              strokeWidth={2.5}
              dot={{ r: 3 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </>
  );
}

// --- shared ----------------------------------------------------------------

const tooltipStyle = {
  backgroundColor: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 8,
  color: '#e2e8f0',
};

export function Empty({ label }) {
  return <p className="muted empty">{label}</p>;
}
