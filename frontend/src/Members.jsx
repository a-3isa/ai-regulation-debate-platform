// Members page: add, edit and remove the personas that sit on the council.
//
// The form mirrors Week 2's persona schema field for field, and every
// controlled vocabulary (stakeholder tags, expertise topics, document
// categories, tools) is offered as a pick-list rather than free text - so a
// user cannot build a member that the engine would reject or silently mis-read.
// The server still validates everything; its messages are shown next to the
// section they concern.

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Pencil, Plus, RotateCcw, Trash2, UserPlus, X } from 'lucide-react';

import { useAgentColors } from './AgentColorContext.jsx';
import { prettyName } from './Analytics.jsx';
import {
  createPersona,
  deletePersona,
  fetchVocabulary,
  listPersonas,
  resetPersonas,
  updatePersona,
} from './api.js';
import { RoleIcon } from './Stage.jsx';

const BLANK = {
  name: '',
  role: '',
  background: '',
  stance: { core_position: '', non_negotiables: [], open_to: [] },
  priorities: [],
  communication_style: { tone: '', hedging: 'medium', jargon: 'medium', signature_moves: [] },
  expertise: { strong: [], weak: [] },
  retrieval: { query_lens: '', affinity: {}, preferred_categories: [] },
  tools: ['rag_search', 'web_search'],
  temperature: 0.5,
};

function initialsOf(name) {
  return (name || '?')
    .split(/\s+/)
    .filter((p) => p && !/^(dr|prof|mr|ms|mrs)\.?$/i.test(p))
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

export function MembersPage({ debating }) {
  // Colour comes from the shared registry, keyed on the member id - so the
  // colour beside a member's name here is the colour of its line in every
  // chart, and stays that colour when another member is added above it in the
  // list. It used to be the member's index in this array.
  const { colorFor } = useAgentColors();
  const [members, setMembers] = useState(null);
  const [vocab, setVocab] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | persona object
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [flash, setFlash] = useState(null);

  const reload = () =>
    Promise.all([listPersonas(), fetchVocabulary()])
      .then(([list, v]) => {
        setMembers(list);
        setVocab(v);
        setError(null);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [flash]);

  async function remove(member) {
    try {
      await deletePersona(member.id);
      setConfirmDelete(null);
      setFlash(`${member.name} was removed from the council.`);
      reload();
    } catch (e) {
      setConfirmDelete(null);
      setError(e.message);
    }
  }

  async function reset() {
    try {
      const list = await resetPersonas();
      setMembers(list);
      setConfirmReset(false);
      setFlash('The original four members were restored.');
    } catch (e) {
      setConfirmReset(false);
      setError(e.message);
    }
  }

  if (error && !members) {
    return <section className="panel warn">Could not load members: {error}</section>;
  }
  if (!members || !vocab) {
    return (
      <section className="panel">
        <p className="muted empty">Loading members…</p>
      </section>
    );
  }

  if (editing) {
    return (
      <PersonaEditor
        initial={editing === 'new' ? null : editing}
        members={members}
        vocab={vocab}
        onCancel={() => setEditing(null)}
        onSaved={(saved, isNew) => {
          setEditing(null);
          setFlash(isNew ? `${saved.name} joined the council.` : `${saved.name} was updated.`);
          reload();
        }}
      />
    );
  }

  const locked = debating;
  const atMinimum = members.length <= (vocab.min_members || 2);

  return (
    <div className="members-page">
      <section className="panel">
        <div className="members-head">
          <div>
            <h2>
              <UserPlus size={17} aria-hidden="true" /> Council members
            </h2>
            <p className="muted small">
              {members.length} member{members.length === 1 ? '' : 's'}. Changes apply to the next debate.
              A debate needs at least {vocab.min_members || 2}.
            </p>
          </div>
          <div className="members-actions">
            {vocab.reset_available &&
              (confirmReset ? (
                <span className="confirm-inline" role="alert">
                  Discard all changes and restore the original four?
                  <button type="button" className="danger small-button" onClick={reset}>
                    <Check size={14} aria-hidden="true" /> Restore
                  </button>
                  <button type="button" className="ghost small-button" onClick={() => setConfirmReset(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setConfirmReset(true)}
                  disabled={locked}
                >
                  <RotateCcw size={15} aria-hidden="true" /> Restore originals
                </button>
              ))}
            <button type="button" onClick={() => setEditing('new')} disabled={locked}>
              <Plus size={15} aria-hidden="true" /> Add member
            </button>
          </div>
        </div>

        {locked && (
          <p className="banner warn" role="status">
            A debate is running. Members are re-read on every turn, so editing is paused until it
            finishes.
          </p>
        )}
        {error && (
          <p className="banner error" role="alert">
            {error}
          </p>
        )}
        {flash && (
          <p className="banner ok" role="status">
            {flash}
          </p>
        )}
      </section>

      <div className="member-grid">
        {members.map((member) => (
          <article key={member.id} className="panel member-tile" style={{ '--who': colorFor(member.id) }}>
            <header className="member-tile-head">
              <span className="seat" style={{ color: colorFor(member.id) }}>
                {initialsOf(member.name)}
              </span>
              <div>
                <h3>{member.name}</h3>
                <span className="muted small role">
                  <RoleIcon personaId={member.id} size={12} /> {member.role}
                </span>
              </div>
            </header>

            <p className="member-position">{member.stance.core_position}</p>

            <dl className="member-facts">
              <div>
                <dt>Represents</dt>
                <dd>{member.stakeholder_tag ? prettyName(member.stakeholder_tag) : '—'}</dd>
              </div>
              <div>
                <dt>Top priorities</dt>
                <dd>{member.priorities.slice(0, 3).map(prettyName).join(', ')}</dd>
              </div>
              <div>
                <dt>Strong on</dt>
                <dd>{member.expertise.strong.slice(0, 3).map(prettyName).join(', ')}</dd>
              </div>
            </dl>

            <footer className="member-tile-actions">
              {member.builtin && <span className="chip">original</span>}
              {confirmDelete === member.id ? (
                <span className="confirm-inline" role="alert">
                  Remove {member.name}?
                  <button type="button" className="danger small-button" onClick={() => remove(member)}>
                    <Trash2 size={14} aria-hidden="true" /> Remove
                  </button>
                  <button type="button" className="ghost small-button" onClick={() => setConfirmDelete(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    className="ghost small-button"
                    onClick={() => setEditing(member)}
                    disabled={locked}
                  >
                    <Pencil size={14} aria-hidden="true" /> Edit
                  </button>
                  <button
                    type="button"
                    className="ghost small-button"
                    onClick={() => setConfirmDelete(member.id)}
                    disabled={locked || atMinimum}
                    title={atMinimum ? 'A debate needs at least two members' : undefined}
                  >
                    <Trash2 size={14} aria-hidden="true" /> Remove
                  </button>
                </>
              )}
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}

// --- editor -----------------------------------------------------------------

function PersonaEditor({ initial, members, vocab, onCancel, onSaved }) {
  const isNew = !initial;
  const [form, setForm] = useState(() => structuredClone(initial || BLANK));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [message, setMessage] = useState(null);

  const set = (path, value) =>
    setForm((prev) => {
      const next = structuredClone(prev);
      const keys = path.split('.');
      let node = next;
      keys.slice(0, -1).forEach((k) => {
        node = node[k];
      });
      node[keys[keys.length - 1]] = value;
      return next;
    });

  // Who this member represents: the single highest-affinity tag.
  const represents = useMemo(() => {
    const entries = Object.entries(form.retrieval.affinity || {});
    if (!entries.length) return { tag: null, problem: 'Set at least one perspective below.' };
    const top = Math.max(...entries.map(([, w]) => w));
    const winners = entries.filter(([, w]) => w === top).map(([t]) => t);
    if (winners.length > 1) {
      return {
        tag: null,
        problem: `Tied at ${top} between ${winners.map(prettyName).join(' and ')} - raise one of them.`,
      };
    }
    return { tag: winners[0], problem: null };
  }, [form.retrieval.affinity]);

  // How every other member will weigh this one in a debate.
  const weighedBy = useMemo(() => {
    if (!represents.tag) return [];
    return members
      .filter((m) => m.id !== form.id)
      .map((m) => ({
        name: m.name,
        weight: Number(m.retrieval.affinity?.[represents.tag] ?? 0),
      }));
  }, [members, represents.tag, form.id]);

  const errorsFor = (prefix) => errors.filter((e) => e.field === prefix || e.field.startsWith(`${prefix}.`));

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setErrors([]);
    setMessage(null);
    const payload = structuredClone(form);
    payload.priorities = payload.priorities.map(toSlug).filter(Boolean);
    try {
      const saved = isNew ? await createPersona(payload) : await updatePersona(form.id, payload);
      onSaved(saved, isNew);
    } catch (e) {
      setErrors(e.fieldErrors || []);
      setMessage(e.fieldErrors?.length ? 'Some fields need attention - see the notes below.' : e.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="editor" onSubmit={save} noValidate>
      <section className="panel editor-head">
        <div>
          <h2>{isNew ? 'Add a member' : `Edit ${initial.name}`}</h2>
          <p className="muted small">
            Every field shapes how this member argues. Nothing here is code - it is saved as the same
            persona file the debate engine reads.
          </p>
        </div>
        <div className="members-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            <X size={15} aria-hidden="true" /> Cancel
          </button>
          <button type="submit" disabled={saving}>
            <Check size={15} aria-hidden="true" /> {saving ? 'Saving…' : isNew ? 'Add to council' : 'Save changes'}
          </button>
        </div>
      </section>

      {message && (
        <p className="banner error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" /> {message}
        </p>
      )}

      <div className="grid-2">
        <Section title="Who they are" errors={[...errorsFor('name'), ...errorsFor('role'), ...errorsFor('background'), ...errorsFor('id')]}>
          <Field label="Full name" hint="Shown in the debate. A title such as Dr. is fine.">
            <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </Field>
          <Field label="Role" hint="One line, e.g. “Data protection officer at a hospital network”.">
            <input value={form.role} onChange={(e) => set('role', e.target.value)} required />
          </Field>
          <Field label="Background" hint="A short paragraph (at least 40 characters) of lived experience.">
            <textarea rows={5} value={form.background} onChange={(e) => set('background', e.target.value)} />
          </Field>
        </Section>

        <Section title="What they believe" errors={errorsFor('stance')}>
          <Field label="Core position" hint="Their view in two or three sentences.">
            <textarea rows={4} value={form.stance.core_position} onChange={(e) => set('stance.core_position', e.target.value)} />
          </Field>
          <ListField
            label="Will not concede"
            hint="One per line."
            value={form.stance.non_negotiables}
            onChange={(v) => set('stance.non_negotiables', v)}
          />
          <ListField
            label="Could be persuaded on"
            hint="One per line. Without these a member never changes their mind."
            value={form.stance.open_to}
            onChange={(v) => set('stance.open_to', v)}
          />
        </Section>

        <Section title="Priorities" errors={errorsFor('priorities')}>
          <ListField
            label="In order of importance"
            hint="One per line, most important first - order decides trade-offs. Saved as short identifiers."
            value={form.priorities}
            onChange={(v) => set('priorities', v)}
          />
        </Section>

        <Section title="How they speak" errors={errorsFor('communication_style')}>
          <Field label="Tone" hint="e.g. formal, plain-spoken, urgent">
            <input value={form.communication_style.tone} onChange={(e) => set('communication_style.tone', e.target.value)} />
          </Field>
          <div className="field-row">
            <Field label="Hedging">
              <select value={form.communication_style.hedging} onChange={(e) => set('communication_style.hedging', e.target.value)}>
                {vocab.levels.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="Jargon">
              <select value={form.communication_style.jargon} onChange={(e) => set('communication_style.jargon', e.target.value)}>
                {vocab.levels.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label={`Creativity (${Number(form.temperature ?? 0.5).toFixed(1)})`} hint="Lower is steadier.">
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={form.temperature ?? 0.5}
                onChange={(e) => set('temperature', Number(e.target.value))}
              />
            </Field>
          </div>
          <ListField
            label="Habits"
            hint="Concrete and observable, one per line - e.g. “cites Article numbers”."
            value={form.communication_style.signature_moves}
            onChange={(v) => set('communication_style.signature_moves', v)}
          />
        </Section>

        <Section title="Expertise" errors={errorsFor('expertise')}>
          <ChipPicker
            label="Strong on"
            options={vocab.expertise_topics}
            value={form.expertise.strong}
            disabledOptions={form.expertise.weak}
            onChange={(v) => set('expertise.strong', v)}
          />
          <ChipPicker
            label="Weak on"
            hint="Required - a member who knows everything argues like everyone else."
            options={vocab.expertise_topics}
            value={form.expertise.weak}
            disabledOptions={form.expertise.strong}
            onChange={(v) => set('expertise.weak', v)}
          />
        </Section>

        <Section title="Whose evidence they trust" errors={errorsFor('retrieval')}>
          <p className="muted small">
            How much weight this member gives each perspective, from 0 to 1. The highest one is who they
            represent - and it decides how much the rest of the council listens to them.
          </p>
          <div className="affinity">
            {vocab.stakeholder_tags.map((tag) => {
              const has = tag in (form.retrieval.affinity || {});
              const value = has ? form.retrieval.affinity[tag] : 0;
              return (
                <label key={tag} className={has ? 'affinity-row on' : 'affinity-row'}>
                  <input
                    type="checkbox"
                    checked={has}
                    onChange={(e) => {
                      const next = { ...form.retrieval.affinity };
                      if (e.target.checked) next[tag] = 0.5;
                      else delete next[tag];
                      set('retrieval.affinity', next);
                    }}
                  />
                  <span className="affinity-tag">{prettyName(tag)}</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={value}
                    disabled={!has}
                    aria-label={`Weight for ${prettyName(tag)}`}
                    onChange={(e) =>
                      set('retrieval.affinity', { ...form.retrieval.affinity, [tag]: Number(e.target.value) })
                    }
                  />
                  <span className="num affinity-value">{has ? value.toFixed(1) : '—'}</span>
                </label>
              );
            })}
          </div>

          <div className={represents.problem ? 'represents problem' : 'represents'}>
            {represents.problem ? (
              <>
                <AlertTriangle size={14} aria-hidden="true" /> {represents.problem}
              </>
            ) : (
              <>
                Represents <strong>{prettyName(represents.tag)}</strong>
              </>
            )}
          </div>

          {weighedBy.length > 0 && (
            <div className="weighed-by">
              <span className="muted small">How the rest of the council will weigh this member:</span>
              <ul>
                {weighedBy.map(({ name, weight }) => (
                  <li key={name} className={weight === 0 ? 'zero' : undefined}>
                    {name} <span className="num">{weight.toFixed(1)}</span>
                    {weight === 0 && <span className="muted small"> - doesn't value this perspective at all</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Field label="Standing concerns in every search" hint="Keywords blended into each evidence lookup.">
            <input value={form.retrieval.query_lens} onChange={(e) => set('retrieval.query_lens', e.target.value)} />
          </Field>
          <ChipPicker
            label="Preferred sources"
            options={vocab.categories}
            value={form.retrieval.preferred_categories}
            onChange={(v) => set('retrieval.preferred_categories', v)}
          />
          <ChipPicker label="Tools" options={vocab.tools} value={form.tools} onChange={(v) => set('tools', v)} />
        </Section>
      </div>
    </form>
  );
}

// --- form pieces --------------------------------------------------------------

function Section({ title, errors = [], children }) {
  return (
    <fieldset className={errors.length ? 'panel section has-error' : 'panel section'}>
      <legend>{title}</legend>
      {errors.length > 0 && (
        <ul className="field-errors" role="alert">
          {errors.map((e, i) => (
            <li key={i}>
              <AlertTriangle size={13} aria-hidden="true" /> {e.message}
            </li>
          ))}
        </ul>
      )}
      {children}
    </fieldset>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function ListField({ label, hint, value, onChange }) {
  const [text, setText] = useState((value || []).join('\n'));
  return (
    <Field label={label} hint={hint}>
      <textarea
        rows={Math.max(3, (value || []).length + 1)}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean));
        }}
      />
    </Field>
  );
}

function ChipPicker({ label, hint, options, value = [], disabledOptions = [], onChange }) {
  const toggle = (option) =>
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="chips" role="group" aria-label={label}>
        {options.map((option) => {
          const on = value.includes(option);
          const blocked = !on && disabledOptions.includes(option);
          return (
            <button
              key={option}
              type="button"
              className={on ? 'chip-toggle on' : 'chip-toggle'}
              aria-pressed={on}
              disabled={blocked}
              title={blocked ? 'Already chosen in the other list' : undefined}
              onClick={() => toggle(option)}
            >
              {prettyName(option)}
            </button>
          );
        })}
      </div>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

function toSlug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
