// Week 4 analytics, rendered from the `analytics` stream events.
//
// Every number here comes from the Week 4 engine over the wire — nothing is
// recomputed in the browser, so the dashboard and the committed report can
// never disagree.
//
// IDENTITY
// Series colour comes from the shared registry, keyed on the member id. It used
// to come from the loop index, which is why the same member was one colour in
// the trajectory and a different one in the influence ranking — that chart
// re-sorts by score, so its indices are a ranking, not an identity.
//
// THEME
// Axis, grid and tooltip colours are read out of CSS custom properties at
// render time rather than hard-coded, so light and dark restyle the charts
// along with everything else.

import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

/** Typographic minus in anything displayed; aria labels keep ASCII. */
export function fmt(value, dp = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toFixed(dp).replace('-', '−');
}

/**
 * Current values of the chart-related CSS custom properties.
 *
 * Recharts takes colours as props, not classes, so they have to be real strings
 * at render time. Reading them from the computed style of <html> keeps one
 * definition of "grid line" in tokens.css instead of two, and re-reading on a
 * theme change is what makes the charts follow the switch.
 */
function useChartTheme() {
  const read = () => {
    if (typeof window === 'undefined') return {};
    const s = getComputedStyle(document.documentElement);
    const v = (name, fallback) => s.getPropertyValue(name).trim() || fallback;
    return {
      line: v('--line', '#E4E0D9'),
      lineStrong: v('--line-strong', '#CFC9C0'),
      ink: v('--ink', '#14161A'),
      ink3: v('--ink-3', '#4A515A'),
      ink4: v('--ink-4', '#5F656B'),
      surface: v('--surface', '#fff'),
      surface2: v('--surface-2', '#F4F2EE'),
    };
  };

  const [theme, setTheme] = useState(read);

  useEffect(() => {
    // `data-theme` on <html> is what the theme hook writes, so observing that
    // one attribute catches every change — manual switch and OS flip alike.
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

function axisProps(theme) {
  return {
    stroke: theme.ink4,
    tickLine: false,
    axisLine: false,
    tick: { fill: theme.ink4, fontSize: 10, fontFamily: 'var(--font-mono)' },
  };
}

function tooltipProps(theme) {
  return {
    contentStyle: {
      background: theme.surface,
      border: 'none',
      boxShadow: 'var(--e-3)',
      borderRadius: 'var(--r-2)',
      color: theme.ink,
      fontSize: 12,
      fontFamily: 'var(--font-ui)',
      padding: '8px 12px',
    },
    labelStyle: { color: theme.ink3, fontSize: 11, marginBottom: 4 },
    itemStyle: { padding: 0 },
    cursor: { stroke: theme.lineStrong, strokeWidth: 1 },
  };
}

// --- opinion trajectory ----------------------------------------------------

export function OpinionTrajectory({ analytics }) {
  const theme = useChartTheme();
  const { colorFor, dashFor } = useAgentColors();
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
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -22 }}>
        <CartesianGrid stroke={theme.line} vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="round" {...axisProps(theme)} />
        <YAxis domain={[-2, 2]} ticks={[-2, -1, 0, 1, 2]} {...axisProps(theme)} />
        <ReferenceLine y={0} stroke={theme.lineStrong} />
        <Tooltip {...tooltipProps(theme)} formatter={(value) => fmt(value)} />
        {agents.map((agent) => (
          <Line
            key={agent}
            type="monotone"
            dataKey={agent}
            name={prettyName(agent)}
            stroke={colorFor(agent)}
            strokeDasharray={dashFor(agent) || undefined}
            strokeWidth={2.2}
            dot={{ r: 3, strokeWidth: 1.5, stroke: theme.surface, fill: colorFor(agent) }}
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
    <ResponsiveContainer width="100%" height={230}>
      <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -22 }}>
        <CartesianGrid stroke={theme.line} vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="round" {...axisProps(theme)} />
        <YAxis domain={[0, 1]} {...axisProps(theme)} />
        <Tooltip {...tooltipProps(theme)} formatter={(value) => value.toFixed(4)} />
        {/* Agreement is a property of the room, not of any member, so it is
            drawn in ink — borrowing a member's colour would imply ownership. */}
        <Line
          type="monotone"
          dataKey="score"
          name="agreement"
          stroke={theme.ink}
          strokeWidth={2.2}
          dot={{ r: 3.5, strokeWidth: 1.5, stroke: theme.surface, fill: theme.ink }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: theme.surface }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// --- influence -------------------------------------------------------------

//: Below this many attributed interactions the score is real but thin, and the
//: row says so. The engine withholds entirely below its own floor; this is the
//: band between "withheld" and "solid".
const THIN_EVIDENCE = 5;

//: Pips are a strip, not a bar chart — past this they stop being countable and
//: the `n=` beside them carries the number instead.
const MAX_PIPS = 12;

//: How far from zero mean_alignment has to be before it is called a direction
//: rather than a mix. Inside the band it is genuinely both.
const ALIGNMENT_BAND = 0.25;

function directionWord(alignment) {
  if (typeof alignment !== 'number') return 'no direction on record';
  if (alignment > ALIGNMENT_BAND) return 'toward them';
  if (alignment < -ALIGNMENT_BAND) return 'away from them';
  return 'no clear push';
}

/**
 * The influence panel: three facts, three encodings, one row.
 *
 *   magnitude  the bar's length       — how far listeners moved
 *   evidence   pips + a literal n=    — how much this rests on
 *   direction  a needle in its own
 *              gutter column          — which way they moved
 *
 * The direction needle lives OUTSIDE the plot area on purpose. Put it inside
 * and it reads as part of the bar, which is exactly the merge that made a
 * previous version report a polarizing member as negatively influential.
 */
export function InfluenceRanking({ analytics }) {
  const { colorFor } = useAgentColors();
  const raw = analytics?.influence || {};
  const detail = analytics?.influence_detail || {};

  const rows = Object.entries(raw)
    .map(([agent, value]) => {
      const info = detail[agent] || {};
      const scored = typeof value === 'number';
      return {
        agent,
        scored,
        score: scored ? value : null,
        n: typeof info.num_attributed_interactions === 'number' ? info.num_attributed_interactions : null,
        dirN: typeof info.num_directional_interactions === 'number' ? info.num_directional_interactions : null,
        alignment: typeof info.mean_alignment === 'number' ? info.mean_alignment : null,
      };
    })
    // Withheld rows sort last, but they are never hidden: a withheld number is
    // a finding, and dropping the row would report it as an absence.
    .sort((a, b) => (b.scored - a.scored) || (b.score ?? 0) - (a.score ?? 0));

  if (!rows.length) return <Empty label="Influence is scored once opinions start moving." />;

  const peak = Math.max(...rows.map((r) => r.score ?? 0), 0.0001);

  return (
    <>
      <div className="influence-grid">
        <div className="col-head">Member</div>
        <div className="col-head">Magnitude &amp; evidence</div>
        <div className="col-head">Direction</div>

        {rows.map((row) => {
          const colour = colorFor(row.agent);
          const pipCount = Math.min(row.n ?? 0, MAX_PIPS);
          const thin = row.scored && row.n !== null && row.n < THIN_EVIDENCE;
          // −1..+1 mapped onto the track's width.
          const needleLeft = row.alignment === null ? 50 : 50 + row.alignment * 50;

          return (
            <div className="influence-row" key={row.agent}>
              <div className="influence-who">
                <span className="seat seat-sm" style={{ '--who': colour }} aria-hidden="true">
                  {initialsOf(row.agent)}
                </span>
                <span className="nm">{prettyName(row.agent)}</span>
              </div>

              <div>
                <div className="bar-wrap">
                  <div className="bar">
                    {row.scored ? (
                      <div
                        className="bar-fill"
                        style={{ width: `${Math.max(2, (row.score / peak) * 100)}%`, background: colour }}
                      />
                    ) : (
                      // A dashed rail, never an empty bar. An empty bar reads as
                      // "measured, and it was zero" — the opposite of the truth.
                      <div className="bar-rail" />
                    )}
                  </div>
                  <span className={row.scored ? 'bar-score' : 'bar-score withheld'}>
                    {row.scored ? fmt(row.score, 3) : 'withheld'}
                  </span>
                </div>

                <div className="evidence-row">
                  <span
                    className="pips"
                    role="img"
                    aria-label={`${row.n ?? 0} attributed interaction${row.n === 1 ? '' : 's'}`}
                  >
                    {Array.from({ length: MAX_PIPS }, (_, i) => (
                      <span key={i} className={i < pipCount ? undefined : 'off'} />
                    ))}
                  </span>
                  <span className="evidence-n">n={row.n ?? 0}</span>
                  {!row.scored && (
                    <span className="evidence-note thin">below the engine&apos;s floor — not a zero</span>
                  )}
                  {thin && <span className="evidence-note thin">thin sample</span>}
                </div>
              </div>

              <div className="direction">
                <div
                  className="direction-track"
                  role="img"
                  aria-label={
                    row.alignment === null
                      ? `${prettyName(row.agent)}: no direction on record`
                      : `${prettyName(row.agent)}: mean alignment ${row.alignment.toFixed(2)}, listeners moved ${directionWord(row.alignment)}`
                  }
                >
                  <div className="rail" />
                  <div className="centre" />
                  {row.alignment !== null && (
                    <div className="needle" style={{ left: `${needleLeft}%`, background: colour }} />
                  )}
                </div>
                <div className="direction-text">{directionWord(row.alignment)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="direction-scale">
        <span>&larr; away</span>
        <span>no clear push</span>
        <span>toward &rarr;</span>
      </div>

      <InfluenceDetailTable rows={rows} colorFor={colorFor} />
    </>
  );
}

/** Every number above, unrounded, with the sample it rests on. */
function InfluenceDetailTable({ rows, colorFor }) {
  return (
    <div className="influence-detail">
      <table>
        <caption>
          influence_detail — the same figures, unrounded, with the sample behind each.
          Magnitude says how far listeners moved; it never says which way.
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: 'left' }}>Member</th>
            <th scope="col">Score</th>
            <th scope="col">Attributed</th>
            <th scope="col">Directional</th>
            <th scope="col">Mean align.</th>
            <th scope="col" style={{ textAlign: 'left' }}>Read</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.agent}>
              <th scope="row">
                <span className="sw" style={{ background: colorFor(row.agent) }} aria-hidden="true" />
                {prettyName(row.agent)}
              </th>
              <td className="num">{row.scored ? row.score.toFixed(4) : '—'}</td>
              <td className="num">{row.n ?? '—'}</td>
              <td className="num">{row.dirN ?? '—'}</td>
              <td className="num">{row.alignment === null ? '—' : fmt(row.alignment, 2)}</td>
              <td className="read">{readingOf(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The sentence a reader would have to construct themselves otherwise. */
function readingOf(row) {
  if (!row.scored) {
    return `Not measured — ${row.n ?? 0} attributed interaction${row.n === 1 ? '' : 's'} is below the engine's floor. This is missing evidence, not an absence of influence.`;
  }
  const strength = row.n !== null && row.n < THIN_EVIDENCE ? 'on a thin sample, ' : '';
  if (row.alignment === null) return `Moved listeners ${strength}with no direction on record.`;
  if (row.alignment > ALIGNMENT_BAND) {
    return `Moved listeners ${strength}and moved them toward their own position.`;
  }
  if (row.alignment < -ALIGNMENT_BAND) {
    return `Moved listeners ${strength}but pushed them away from their position.`;
  }
  return `Moved listeners ${strength}toward and away in roughly equal measure.`;
}

function initialsOf(id) {
  return prettyName(id)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

// --- sentiment -------------------------------------------------------------

/**
 * One bar per message, in speaking order, coloured by speaker.
 *
 * Deliberately not a line: sentiment is a property of an individual turn, and a
 * line implies a continuous quantity moving between them. Bars also let the
 * speaker's colour do the grouping without a second legend.
 */
export function SentimentPanel({ analytics, messages }) {
  const theme = useChartTheme();
  const { colorFor } = useAgentColors();
  const sentiment = analytics?.sentiment || [];
  if (!sentiment.length) return <Empty label="Sentiment is scored per message." />;

  const senderOf = new Map(messages.map((m) => [m.message_id, m.sender]));
  const roundOf = new Map(messages.map((m) => [m.message_id, m.round]));

  const data = sentiment.map((point, index) => ({
    i: index,
    score: point.score,
    agent: senderOf.get(point.message_id) || 'unknown',
    round: roundOf.get(point.message_id),
  }));

  const distribution = { positive: 0, neutral: 0, negative: 0 };
  sentiment.forEach((p) => {
    if (distribution[p.label] !== undefined) distribution[p.label] += 1;
  });
  const mean = sentiment.reduce((sum, p) => sum + p.score, 0) / sentiment.length;

  return (
    <>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -22 }}>
          <CartesianGrid stroke={theme.line} vertical={false} strokeDasharray="2 4" />
          <XAxis dataKey="round" {...axisProps(theme)} />
          <YAxis domain={[-1, 1]} ticks={[-1, 0, 1]} {...axisProps(theme)} />
          <ReferenceLine y={0} stroke={theme.lineStrong} />
          <Tooltip
            {...tooltipProps(theme)}
            labelFormatter={(round) => `Round ${round}`}
            formatter={(value, _n, item) => [fmt(value, 3), prettyName(item?.payload?.agent)]}
          />
          <Bar dataKey="score" radius={[2, 2, 2, 2]} isAnimationActive={false}>
            {data.map((row) => (
              <Cell key={row.i} fill={colorFor(row.agent)} fillOpacity={0.9} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="chart-foot">
        <span>
          {distribution.positive} positive · {distribution.neutral} neutral · {distribution.negative} negative
        </span>
        <span className="num">mean {fmt(mean, 3)}</span>
      </div>
      {analytics?.sentiment_backend && (
        <p className="micro" style={{ margin: 'var(--s-2) 0 0' }}>
          Scored with {analytics.sentiment_backend}.
        </p>
      )}
    </>
  );
}

// --- shared ----------------------------------------------------------------

export function Empty({ label }) {
  return <p className="empty">{label}</p>;
}
