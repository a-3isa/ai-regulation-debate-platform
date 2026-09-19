// The table: the council seated in a ring, the live edge showing who is
// addressing whom, the roster with each member's stance, and the transcript.
//
// The ring is not decoration. Week 3 routes messages along a weighted, directed
// graph — under the default ring topology each member hears exactly one other —
// and that is the hardest thing to see in a flat transcript. Drawing the graph
// with the active edge lit makes the routing visible while it happens.
//
// It earns that space only WHILE THE DEBATE IS LIVE. Once the run is finished
// it is a static graph you read five minutes ago, so it demotes to a thumbnail
// and the closing exchange takes the room.
//
// Every component here takes a `personaId` and resolves identity through the
// shared registry, so a member keeps one colour across the ring, the roster,
// the transcript and every chart.

import React, { useEffect, useRef, useState } from 'react';
import { Quote, Search } from 'lucide-react';

import { useAgentColor, useAgentColors } from './AgentColorContext.jsx';
import { fmt, prettyName } from './Analytics.jsx';

export function initials(name, personaId) {
  const source = (name || prettyName(personaId) || '?').trim();
  const parts = source.split(/\s+/).filter((p) => !/^(dr|prof|mr|ms|mrs)\.?$/i.test(p));
  return parts.slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

export function displayName(personas, personaId) {
  return personas?.[personaId]?.name || prettyName(personaId);
}

/** Plain language for a -2..+2 stance, so no scale is needed to read it. */
export function stanceWord(value) {
  if (typeof value !== 'number') return 'no position yet';
  if (value <= -1.5) return 'Strongly against';
  if (value <= -0.5) return 'Against';
  if (value < 0.5) return 'Undecided';
  if (value < 1.5) return 'For';
  return 'Strongly for';
}

/**
 * The avatar. Initials only, from the persona name — never an image, never an
 * emoji, never an icon inside the disc, at any size.
 */
export function Seat({ personaId, personas, size = 'md', speaking = false }) {
  const color = useAgentColor(personaId);
  const classes = ['seat', `seat-${size}`];
  if (speaking) classes.push('speaking');
  return (
    <span className={classes.join(' ')} style={{ '--who': color }} aria-hidden="true">
      {initials(personas?.[personaId]?.name, personaId)}
    </span>
  );
}

// --- the ring -------------------------------------------------------------

export function ChamberRing({ agents, personas, graph, speaking, lastMessage, stances, compact = false }) {
  const { colorFor } = useAgentColors();
  if (!agents?.length) return null;

  const size = 300;
  const centre = size / 2;
  const radius = compact ? 92 : 104;

  const seats = agents.map((agent, index) => {
    const angle = (index / agents.length) * 2 * Math.PI - Math.PI / 2;
    return { agent, x: centre + radius * Math.cos(angle), y: centre + radius * Math.sin(angle) };
  });
  const at = Object.fromEntries(seats.map((s) => [s.agent, s]));

  // Edges come from the discussion graph, which carries real affinity weights
  // (sender -> {recipient: weight}); the legacy list shape has no weights.
  const edges = [];
  Object.entries(graph || {}).forEach(([from, targets]) => {
    const entries = Array.isArray(targets)
      ? targets.map((to) => [to, null])
      : Object.entries(targets || {});
    entries.forEach(([to, weight]) => {
      if (at[from] && at[to]) edges.push({ from, to, weight });
    });
  });

  const activeFrom = speaking || lastMessage?.sender;
  const outgoing = graph?.[activeFrom];
  const activeTo = speaking
    ? (Array.isArray(outgoing) ? outgoing : Object.keys(outgoing || {}))[0]
    : lastMessage?.recipients?.[0];

  // A generated sentence, and a visually-hidden table beneath it, so the graph
  // is navigable rather than just described.
  const label = activeFrom
    ? `${displayName(personas, activeFrom)} is addressing ${displayName(personas, activeTo)}.`
    : 'Who is talking to whom.';

  return (
    <>
      <svg
        className={compact ? 'ring ring-thumb' : 'ring'}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${label} ${edges.length} connections.`}
      >
        <defs>
          {seats.map(({ agent }) => (
            <marker
              key={agent}
              id={`arw-${agent}`}
              viewBox="0 0 8 8"
              refX="6.5"
              refY="4"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0,1 L7,4 L0,7 z" fill={colorFor(agent)} />
            </marker>
          ))}
        </defs>

        <circle cx={centre} cy={centre} r={radius} fill="none" stroke="var(--line)" strokeWidth="1" strokeDasharray="2 5" />

        {edges.map(({ from, to, weight }) => {
          const a = at[from];
          const b = at[to];
          const live = from === activeFrom && to === activeTo;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const pad = 26;
          const x1 = a.x + (dx / len) * pad;
          const y1 = a.y + (dy / len) * pad;
          const x2 = b.x - (dx / len) * pad;
          const y2 = b.y - (dy / len) * pad;
          const w = typeof weight === 'number' ? weight : 1;
          return (
            <g key={`${from}->${to}`} opacity={live ? 1 : 0.34}>
              <path
                d={`M${x1},${y1} L${x2},${y2}`}
                fill="none"
                stroke={colorFor(from)}
                strokeWidth={1 + w * 2.4}
                strokeLinecap="round"
                markerEnd={`url(#arw-${from})`}
              />
              {typeof weight === 'number' && !compact && (
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2 - 4}
                  textAnchor="middle"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '8.5px', fill: 'var(--ink-4)' }}
                >
                  {weight.toFixed(2)}
                </text>
              )}
            </g>
          );
        })}

        {seats.map(({ agent, x, y }) => {
          const isSpeaking = agent === speaking;
          const stance = stances?.[agent];
          const colour = colorFor(agent);
          const short = (personas?.[agent]?.name || prettyName(agent)).split(' ').slice(-1)[0];
          return (
            <g key={agent}>
              {isSpeaking && <circle cx={x} cy={y} r={28} fill={colour} opacity="0.16" />}
              <circle cx={x} cy={y} r={20} fill={colour} />
              <circle cx={x} cy={y} r={17.5} style={{ fill: 'var(--surface)' }} />
              <circle cx={x} cy={y} r={17.5} fill={colour} opacity="0.13" />
              <text
                x={x}
                y={y + 4}
                textAnchor="middle"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, fill: 'var(--ink)' }}
              >
                {initials(personas?.[agent]?.name, agent)}
              </text>
              {!compact && (
                <>
                  <text
                    x={x}
                    y={y + 34}
                    textAnchor="middle"
                    style={{ fontFamily: 'var(--font-ui)', fontSize: '9.5px', fontWeight: 600, fill: 'var(--ink-2)' }}
                  >
                    {short}
                  </text>
                  {typeof stance === 'number' && (
                    <text
                      x={x}
                      y={y + 46}
                      textAnchor="middle"
                      style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', fill: 'var(--ink-3)' }}
                    >
                      {stance > 0 ? `+${stance.toFixed(1)}` : fmt(stance, 1)}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}
      </svg>

      {/* Duplicated for screen-reader table navigation: an aria-label sentence
          can be heard but not explored, and this graph has real numbers in it. */}
      <table className="sr-only">
        <caption>Who addresses whom, and how much weight the speaker gives them</caption>
        <thead>
          <tr><th scope="col">Speaker</th><th scope="col">Listener</th><th scope="col">Weight</th></tr>
        </thead>
        <tbody>
          {edges.map(({ from, to, weight }) => (
            <tr key={`sr-${from}-${to}`}>
              <td>{displayName(personas, from)}</td>
              <td>{displayName(personas, to)}</td>
              <td>{typeof weight === 'number' ? weight.toFixed(2) : 'unweighted'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// --- the roster -----------------------------------------------------------

//: Tick positions on the -2..+2 track.
const STANCE_TICKS = [0, 25, 50, 75, 100];

export function MemberCard({ personaId, persona, personas, stance, delta, speaking, turns }) {
  const color = useAgentColor(personaId);
  const has = typeof stance === 'number';
  const clamped = has ? Math.max(-2, Math.min(2, stance)) : 0;
  // 0% = -2, 50% = 0, 100% = +2.
  const pct = ((clamped + 2) / 4) * 100;
  const half = (Math.abs(clamped) / 2) * 50;

  return (
    <article className={speaking ? 'member speaking' : 'member'} style={{ '--who': color }}>
      <div className="member-head">
        <Seat personaId={personaId} personas={personas} speaking={speaking} />
        <div className="member-id">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
            <span className="name">{persona?.name || prettyName(personaId)}</span>
            {typeof turns === 'number' && <span className="micro">{turns} turn{turns === 1 ? '' : 's'}</span>}
          </div>
          <div className="role">{persona?.role || prettyName(personaId)}</div>
        </div>
      </div>

      <div
        className="stance-row"
        role="img"
        aria-label={`${persona?.name || prettyName(personaId)} stance ${has ? clamped.toFixed(2) : 'not yet scored'} of -2 to +2, ${stanceWord(has ? clamped : undefined)}`}
      >
        <div className="meter">
          <span className="meter-track" />
          {STANCE_TICKS.map((left) => (
            <span key={left} className="meter-tick" style={{ left: `${left}%` }} />
          ))}
          {has && (
            <>
              <span
                className="meter-fill"
                style={{ left: clamped >= 0 ? '50%' : `${50 - half}%`, width: `${half}%` }}
              />
              <span className="meter-dot" style={{ left: `${pct}%` }} />
            </>
          )}
        </div>
        {/* The number is printed regardless — the bar is never the only
            carrier of meaning. */}
        <span className="stance-value">{has ? (clamped > 0 ? `+${clamped.toFixed(2)}` : fmt(clamped)) : '—'}</span>
      </div>

      <div className="stance-foot">
        <span>{stanceWord(has ? clamped : undefined)}</span>
        <span className="num">
          {typeof delta === 'number' && delta !== 0
            ? `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)} this round`
            : 'held'}
        </span>
      </div>
    </article>
  );
}

// --- the transcript -------------------------------------------------------

//: Turns longer than this many words are clipped, with a counted affordance.
//: A 5-round, 4-member debate is a 6,000-word wall otherwise, and the live
//: scroll position fights the SSE append on every event.
const CLIP_WORDS = 90;

function wordCount(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function Floor({ run, personas }) {
  const { colorFor } = useAgentColors();
  const endRef = useRef(null);
  const [expanded, setExpanded] = useState({});
  const [collapsed, setCollapsed] = useState({});

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [run.messages.length, run.speaking]);

  const byRound = new Map();
  run.messages.forEach((message) => {
    if (!byRound.has(message.round)) byRound.set(message.round, []);
    byRound.get(message.round).push(message);
  });

  const retrievalsByRound = new Map();
  run.retrievals.forEach((event) => {
    if (!retrievalsByRound.has(event.round)) retrievalsByRound.set(event.round, []);
    retrievalsByRound.get(event.round).push(event);
  });

  const lastMessageId = run.messages[run.messages.length - 1]?.message_id;

  return (
    <div className="transcript-scroll" aria-live="polite" aria-relevant="additions">
      {run.messages.length === 0 && !run.speaking && (
        <p className="empty" style={{ margin: 'var(--s-4)' }}>
          The members are reading the Act and forming their opening positions.
        </p>
      )}

      {[...byRound.entries()].map(([round, messages]) => {
        const lookups = retrievalsByRound.get(round)?.length || 0;
        const open = !collapsed[round];
        return (
          <section key={round}>
            <h3 className="round-head">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setCollapsed((prev) => ({ ...prev, [round]: !prev[round] }))}
              >
                <span className="label">Round {round}</span>
                <span className="sub">{messages.length} turn{messages.length === 1 ? '' : 's'}</span>
              </button>
              {lookups > 0 && (
                <span className="right">
                  <Search size={11} aria-hidden="true" /> {lookups} lookup{lookups === 1 ? '' : 's'}
                </span>
              )}
            </h3>

            {open &&
              messages.map((message) => {
                const colour = colorFor(message.sender);
                const words = wordCount(message.content);
                // The turn still streaming is never clipped; it collapses on
                // its own once the next speaker starts.
                const isLatest = message.message_id === lastMessageId && !!run.speaking;
                const long = words > CLIP_WORDS && !isLatest;
                const isOpen = expanded[message.message_id];
                const clipped = long && !isOpen;

                return (
                  <article className="speech" key={message.message_id} style={{ '--who': colour }}>
                    <Seat personaId={message.sender} personas={personas} size="sm" />
                    <div className="speech-body">
                      <div className="speech-meta">
                        <span className="name" style={{ color: colour }}>
                          {displayName(personas, message.sender)}
                        </span>
                        <span className="to">
                          to {message.recipients.map((r) => displayName(personas, r)).join(', ')}
                        </span>
                        {message.used_retrieval && (
                          <span className="cite">
                            <Quote size={10} aria-hidden="true" /> cited evidence
                          </span>
                        )}
                      </div>

                      <div className={clipped ? 'speech-text clipped' : 'speech-text'}>
                        <p>{message.content}</p>
                        {clipped && <span className="speech-fade" />}
                      </div>

                      {long && (
                        // Counted, never a bare fade: the number is the whole
                        // point — it says how much is still hidden.
                        <button
                          type="button"
                          className="btn-quiet"
                          style={{ marginTop: 'var(--s-2)' }}
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [message.message_id]: !prev[message.message_id] }))
                          }
                        >
                          {isOpen ? 'Collapse turn' : `Show full turn (${words} words)`}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
          </section>
        );
      })}

      {run.speaking && (
        <div className="typing">
          <Seat personaId={run.speaking} personas={personas} size="sm" speaking />
          <span className="small muted">{displayName(personas, run.speaking)} is writing a reply</span>
          <span className="typing-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
