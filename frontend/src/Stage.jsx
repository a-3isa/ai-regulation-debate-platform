// The chamber: the council seated in a ring, the live arrow showing who is
// addressing whom, and the debate itself as speech on the floor.
//
// The ring is not decoration. Week 3 routes messages along a graph - under the
// default ring topology each agent hears exactly one other - and that is the
// hardest thing to see in a flat transcript. Drawing the graph with the active
// edge lit makes the routing visible while it happens, and labels each edge
// with its real affinity weight.

import React, { useEffect, useRef } from 'react';
import { GraduationCap, Landmark, Loader2, Megaphone, Quote, Rocket, Search, UserRound } from 'lucide-react';

import { agentColor, prettyName } from './Analytics.jsx';

// A role glyph per persona - vector icons, never emoji, so they inherit colour
// and stay legible at any size.
const ROLE_ICONS = {
  eu_regulator: Landmark,
  startup_founder: Rocket,
  civil_society_advocate: Megaphone,
  academic_researcher: GraduationCap,
};

export function RoleIcon({ personaId, size = 15 }) {
  const Icon = ROLE_ICONS[personaId] || UserRound;
  return <Icon size={size} aria-hidden="true" />;
}

export function initials(name, personaId) {
  const source = (name || prettyName(personaId) || '?').trim();
  const parts = source.split(/\s+/).filter((p) => !/^(dr|prof|mr|ms|mrs)\.?$/i.test(p));
  return parts.slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

export function displayName(personas, personaId) {
  return personas?.[personaId]?.name || prettyName(personaId);
}

export function Seat({ personaId, personas, index, size = 'md' }) {
  const color = agentColor(index);
  return (
    <span
      className={`seat seat-${size}`}
      style={{ borderColor: color, color }}
      aria-hidden="true"
    >
      {initials(personas?.[personaId]?.name, personaId)}
    </span>
  );
}

// --- the ring -------------------------------------------------------------

export function ChamberRing({ agents, personas, graph, speaking, lastMessage, stances }) {
  if (!agents?.length) return null;

  const size = 340;
  const radius = 112;
  const centre = size / 2;
  const seats = agents.map((agent, index) => {
    const angle = (index / agents.length) * 2 * Math.PI - Math.PI / 2;
    return {
      agent,
      index,
      x: centre + radius * Math.cos(angle),
      y: centre + radius * Math.sin(angle),
    };
  });
  const at = Object.fromEntries(seats.map((s) => [s.agent, s]));

  // Edges come from the discussion graph. It carries real affinity weights
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

  return (
    <svg
      className="ring"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={
        activeFrom
          ? `${displayName(personas, activeFrom)} is talking to ${displayName(personas, activeTo)}`
          : 'Who is talking to whom'
      }
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--line-strong)" />
        </marker>
        <marker id="arrow-live" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--brass)" />
        </marker>
      </defs>

      <circle cx={centre} cy={centre} r={radius - 34} className="ring-table" />

      {edges.map(({ from, to, weight }) => {
        const a = at[from];
        const b = at[to];
        const live = from === activeFrom && to === activeTo;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const pad = 32;
        const x1 = a.x + (dx / len) * pad;
        const y1 = a.y + (dy / len) * pad;
        const x2 = b.x - (dx / len) * pad;
        const y2 = b.y - (dy / len) * pad;
        return (
          <g key={`${from}->${to}`}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={live ? 'ring-edge live' : 'ring-edge'}
              // Edge weight is this sender's affinity for that listener: a
              // thicker line means the listener's perspective carries more
              // weight with the speaker.
              strokeWidth={typeof weight === 'number' ? 1 + weight * 2.5 : 1.5}
              markerEnd={live ? 'url(#arrow-live)' : 'url(#arrow)'}
            />
            {typeof weight === 'number' && (
              <text
                x={(x1 + x2) / 2}
                y={(y1 + y2) / 2 - 4}
                textAnchor="middle"
                className={live ? 'ring-weight live' : 'ring-weight'}
              >
                {weight.toFixed(2)}
              </text>
            )}
          </g>
        );
      })}

      {seats.map(({ agent, index, x, y }) => {
        const isSpeaking = agent === speaking;
        const stance = stances?.[agent];
        const color = agentColor(index);
        const label = (personas?.[agent]?.name || prettyName(agent)).split(' ').slice(-1)[0];
        return (
          <g key={agent} className={isSpeaking ? 'ring-seat speaking' : 'ring-seat'}>
            {isSpeaking && <circle cx={x} cy={y} r={28} className="pulse" stroke={color} />}
            <circle cx={x} cy={y} r={22} className="ring-seat-disc" stroke={color} />
            <text x={x} y={y + 5} textAnchor="middle" className="ring-initials" fill={color}>
              {initials(personas?.[agent]?.name, agent)}
            </text>
            <text x={x} y={y + 40} textAnchor="middle" className="ring-label">
              {label}
            </text>
            {typeof stance === 'number' && (
              <text x={x} y={y + 54} textAnchor="middle" className="ring-stance" fill={color}>
                {stance > 0 ? `+${stance.toFixed(1)}` : stance.toFixed(1)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// --- the roster -----------------------------------------------------------

export function MemberCard({ personaId, persona, personas, index, stance, delta, speaking }) {
  const color = agentColor(index);
  return (
    <article className={speaking ? 'member speaking' : 'member'} style={{ '--who': color }}>
      <div className="member-head">
        <Seat personaId={personaId} personas={personas} index={index} />
        <div className="member-id">
          <strong>{persona?.name || prettyName(personaId)}</strong>
          <span className="muted small role">
            <RoleIcon personaId={personaId} size={12} /> {persona?.role || prettyName(personaId)}
          </span>
        </div>
      </div>

      <div className="member-stance">
        <StanceMeter value={stance} color={color} personaId={personaId} />
        <span className="stance-number">
          {typeof stance === 'number' ? (stance > 0 ? `+${stance.toFixed(2)}` : stance.toFixed(2)) : '—'}
          {delta ? (
            <em className={delta > 0 ? 'up' : 'down'}>
              {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(2)}
            </em>
          ) : null}
        </span>
      </div>

      {speaking && (
        <p className="member-speaking">
          <Loader2 size={12} className="spin" aria-hidden="true" /> speaking
        </p>
      )}
    </article>
  );
}

// A -2..+2 stance drawn as a bar growing left or right of centre. The number is
// always printed next to it, so the bar is never the only carrier of meaning.
function StanceMeter({ value, color, personaId }) {
  const v = typeof value === 'number' ? Math.max(-2, Math.min(2, value)) : 0;
  const halfWidth = (Math.abs(v) / 2) * 50;
  return (
    <div
      className="meter"
      role="img"
      aria-label={`${prettyName(personaId)} stance ${v.toFixed(2)} on a scale from -2 opposed to +2 supportive`}
    >
      <span className="meter-centre" />
      <span
        className="meter-fill"
        style={{
          background: color,
          width: `${halfWidth}%`,
          left: v >= 0 ? '50%' : `${50 - halfWidth}%`,
        }}
      />
    </div>
  );
}

// --- the floor ------------------------------------------------------------

export function Floor({ run, agents, personas }) {
  const endRef = useRef(null);

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

  return (
    <div className="floor" aria-live="polite">
      {run.messages.length === 0 && !run.speaking && (
        <p className="muted empty">
          Members are reading the evidence and forming their opening positions…
        </p>
      )}

      {[...byRound.entries()].map(([round, messages]) => {
        const lookups = retrievalsByRound.get(round)?.length || 0;
        return (
          <section key={round} className="round-block">
            <h3 className="round-label">
              <span>Round {round}</span>
              {lookups > 0 && (
                <span className="round-evidence">
                  <Search size={11} aria-hidden="true" /> {lookups} evidence lookup{lookups === 1 ? '' : 's'}
                </span>
              )}
            </h3>

            {messages.map((message) => {
              const index = Math.max(0, agents.indexOf(message.sender));
              const color = agentColor(index);
              return (
                <article key={message.message_id} className="speech" style={{ '--who': color }}>
                  <Seat personaId={message.sender} personas={personas} index={index} size="sm" />
                  <div className="speech-body">
                    <header>
                      <strong style={{ color }}>{displayName(personas, message.sender)}</strong>
                      <span className="muted small">
                        to {message.recipients.map((r) => displayName(personas, r)).join(', ')}
                      </span>
                      {message.used_retrieval && (
                        <span className="tag">
                          <Quote size={10} aria-hidden="true" /> used evidence
                        </span>
                      )}
                    </header>
                    <p>{message.content}</p>
                  </div>
                </article>
              );
            })}
          </section>
        );
      })}

      {run.speaking && (
        <div className="speech speaking-now" style={{ '--who': agentColor(Math.max(0, agents.indexOf(run.speaking))) }}>
          <Seat
            personaId={run.speaking}
            personas={personas}
            index={Math.max(0, agents.indexOf(run.speaking))}
            size="sm"
          />
          <div className="speech-body">
            <header>
              <strong>{displayName(personas, run.speaking)}</strong>
              <span className="muted small">is writing a reply</span>
            </header>
            <span className="dots" aria-label="composing a reply">
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
