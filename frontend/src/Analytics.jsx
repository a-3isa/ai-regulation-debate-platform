// Week 4 analytics, rendered live from the `analytics` stream events.
//
// Every number here comes from the Week 4 engine over the wire - nothing is
// recomputed in the browser, so the dashboard and the committed report can
// never disagree.
//
// COLOUR
// Series colour comes from the shared registry in AgentColorContext, keyed on
// the member id. It used to come from the loop index, which is why the same
// member was one colour in the trajectory and a different one in the influence
// ranking - that chart re-sorts by score, so its indices are a ranking, not an
// identity. See agentColors.js.
//
// THEME
// Axis, grid and tooltip colours are read out of CSS custom properties at
// render time rather than hard-coded, so light and dark mode restyle the charts
// along with everything else.

import React, { useEffect, useState } from 'react';
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

import { useAgentColors } from './AgentColorContext.jsx';
import { AGENT_PALETTE, agentColorFor } from './agentColors.js';

export { AGENT_PALETTE, agentColorFor };

export function prettyName(id) {
  return (id || '').replace(/_/g, ' ');
}

/**
 * The current values of the chart-related CSS variables.
 *
 * Recharts takes colours as props, not as classes, so they have to be real
 * strings at render time. Reading them from the computed style of <html> keeps
 * one definition of "grid line" in App.css instead of two, and re-reading on a
 * theme change is what makes the charts follow the toggle.
 */
function useChartTheme() {
  const read = () => {
    if (typeof window === 'undefined') return { grid: '#e5e5e5', axis: '#86868b' };
    const style = getComputedStyle(document.documentElement);
    return {
      grid: style.getPropertyValue('--grid').trim() || '#e5e5e5',
      axis: style.getPropertyValue('--axis').trim() || '#86868b',
      surface: style.getPropertyValue('--surface').trim() || '#fff',
      line: style.getPropertyValue('--line-strong').trim() || '#ddd',
      text: style.getPropertyValue('--text').trim() || '#1d1d1f',
      accent: style.getPropertyValue('--accent').trim() || '#0066cc',
      muted: style.getPropertyValue('--text-muted').trim() || '#6e6e73',
    };
  };

  const [theme, setTheme] = useState(read);

  useEffect(() => {
    // `data-theme` on <html> is what the theme hook writes, so observing that
    // one attribute catches every change - manual toggle and OS switch alike.
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

function axisProps(theme) {
  return {
    stroke: theme.axis,
    tickLine: false,
    axisLine: false,
    tick: { fill: theme.axis, fontSize: 11 },
  };
}

function tooltipProps(theme) {
  return {
    contentStyle: {
      background: theme.surface,
      border: `1px solid ${theme.line}`,
      borderRadius: 12,
      boxShadow: '0 12px 28px rgba(0,0,0,0.12)',
      color: theme.text,
      fontSize: 12,
      padding: '8px 12px',
    },
    labelStyle: { color: theme.muted, fontSize: 11, marginBottom: 4 },
    itemStyle: { padding: 0 },
    cursor: { stroke: theme.line, strokeWidth: 1 },
  };
}

// --- opinion trajectory ----------------------------------------------------

export function OpinionTrajectory({ analytics }) {
  const theme = useChartTheme();
  const { colorFor } = useAgentColors();
  const series = analytics?.opinion_change || {};
  const agents = Object.keys(series).sort();
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
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={theme.grid} vertical={false} />
        <XAxis dataKey="round" {...axisProps(theme)} />
        <YAxis domain={[-2, 2]} ticks={[-2, -1, 0, 1, 2]} {...axisProps(theme)} />
        <ReferenceLine y={0} stroke={theme.axis} strokeDasharray="3 3" />
        <Tooltip {...tooltipProps(theme)} formatter={(value) => value?.toFixed?.(2) ?? value} />
        <Legend
          formatter={prettyName}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
        />
        {agents.map((agent) => (
          <Line
            key={agent}
            type="monotone"
            dataKey={agent}
            stroke={colorFor(agent)}
            strokeWidth={2}
            dot={{ r: 2.5, strokeWidth: 0, fill: colorFor(agent) }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: theme.surface }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// --- agreement -------------------------------------------------------------

export function AgreementTrend({ analytics }) {
  const theme = useChartTheme();
  const points = (analytics?.agreement || []).filter((p) => typeof p.score === 'number');
  if (!points.length) return <Empty label="Agreement is scored once a round completes." />;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="agreement-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.accent} stopOpacity={0.18} />
            <stop offset="100%" stopColor={theme.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={theme.grid} vertical={false} />
        <XAxis dataKey="round" {...axisProps(theme)} />
        <YAxis domain={[0, 1]} {...axisProps(theme)} />
        <Tooltip {...tooltipProps(theme)} formatter={(value) => value.toFixed(4)} />
        <Line
          type="monotone"
          dataKey="score"
          name="agreement"
          stroke={theme.accent}
          strokeWidth={2.5}
          dot={{ r: 2.5, strokeWidth: 0, fill: theme.accent }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: theme.surface }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// --- influence -------------------------------------------------------------

/**
 * The influence ranking, plus the context needed to read it honestly.
 *
 * The headline score is a MAGNITUDE: how much listeners moved in the rounds
 * they read this member. It says nothing about which way they moved, and it
 * cannot distinguish a score from twenty attributed interactions from the same
 * score from one. Both of those facts arrive from the engine in
 * `influence_detail`, and both are shown in the table under the chart rather
 * than left for a reader to assume.
 */
export function InfluenceRanking({ analytics }) {
  const theme = useChartTheme();
  const { colorFor } = useAgentColors();
  const raw = analytics?.influence || {};
  const detail = analytics?.influence_detail || {};

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
            ? 'No member has enough attributable interactions yet (insufficient_data).'
            : 'Influence is scored once opinions start moving.'
        }
      />
    );
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={Math.max(150, scored.length * 46)}>
        <BarChart data={scored} layout="vertical" margin={{ top: 4, right: 28, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={theme.grid} horizontal={false} />
          <XAxis type="number" {...axisProps(theme)} />
          <YAxis
            type="category"
            dataKey="agent"
            width={168}
            {...axisProps(theme)}
            tickFormatter={prettyName}
          />
          <Tooltip {...tooltipProps(theme)} formatter={(value) => value.toFixed(4)} />
          <Bar dataKey="score" radius={[0, 6, 6, 0]} barSize={18} isAnimationActive={false}>
            {scored.map((entry) => (
              // Colour by member id, NOT by rank: this chart is sorted by
              // score, so its row order changes between rounds.
              <Cell key={entry.agent} fill={colorFor(entry.agent)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <table className="influence-detail">
        <colgroup>
          <col />
          <col className="tight" />
          <col className="tight" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col" className="num">Score</th>
            <th scope="col" className="num">Moves</th>
            <th scope="col">Listeners moved</th>
          </tr>
        </thead>
        <tbody>
          {scored.map(({ agent, score }) => {
            const info = detail[agent] || {};
            const alignment = info.mean_alignment;
            const interactions = info.num_attributed_interactions;
            return (
              <tr key={agent}>
                <td>
                  <span className="who">
                    <span className="swatch" style={{ background: colorFor(agent) }} aria-hidden="true" />
                    {prettyName(agent)}
                  </span>
                </td>
                <td className="num">{score.toFixed(4)}</td>
                <td className="num">
                  {typeof interactions === 'number' ? interactions.toFixed(1) : '—'}
                </td>
                <td className={alignmentClass(alignment)}>{alignmentLabel(alignment)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {insufficient.length > 0 && (
        <p className="muted small chart-note">
          <strong>Not measured</strong> ({insufficient.map(([agent]) => prettyName(agent)).join(', ')}):
          no opinion movement could be attributed to them at all, which is different from
          measuring no influence.
        </p>
      )}
      <p className="muted small chart-note">
        The score is how much listeners moved, not which way — the last column carries the
        direction. Association, not proof of causation: a stance move after reading a member is
        consistent with, but not proof of, that member causing it.
      </p>
    </>
  );
}

//: How far from zero `mean_alignment` has to be before it is called a
//: direction rather than a mix. Anything inside the band is genuinely both.
const ALIGNMENT_BAND = 0.25;

function alignmentLabel(alignment) {
  if (typeof alignment !== 'number') return 'no direction on record';
  if (alignment > ALIGNMENT_BAND) return 'towards their position';
  if (alignment < -ALIGNMENT_BAND) return 'away from their position';
  return 'towards and away equally';
}

function alignmentClass(alignment) {
  if (typeof alignment !== 'number') return 'muted small';
  if (alignment > ALIGNMENT_BAND) return 'toward small';
  if (alignment < -ALIGNMENT_BAND) return 'away small';
  return 'muted small';
}

// --- sentiment -------------------------------------------------------------

export function SentimentPanel({ analytics, messages }) {
  const theme = useChartTheme();
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
        <ResponsiveContainer width="100%" height={190}>
          <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <CartesianGrid stroke={theme.grid} vertical={false} />
            <XAxis dataKey="round" {...axisProps(theme)} />
            <YAxis domain={[-1, 1]} {...axisProps(theme)} />
            <ReferenceLine y={0} stroke={theme.axis} strokeDasharray="3 3" />
            <Tooltip {...tooltipProps(theme)} formatter={(value) => value.toFixed(3)} />
            <Line
              type="monotone"
              dataKey="score"
              name="mean tone"
              stroke={AGENT_PALETTE[1]}
              strokeWidth={2.5}
              dot={{ r: 2.5, strokeWidth: 0, fill: AGENT_PALETTE[1] }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: theme.surface }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </>
  );
}

// --- shared ----------------------------------------------------------------

export function Empty({ label }) {
  return <p className="muted empty">{label}</p>;
}
