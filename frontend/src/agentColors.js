// One member, one identity — the same colour and the same dash in every chart,
// on every page, and in the PNGs the report exports.
//
// WHY THIS FILE EXISTS
// Colour used to be `agentColor(index)`, where `index` was whatever position a
// member happened to occupy in whatever array the component was mapping. Those
// are different arrays: the trajectory used the analytics keys, the influence
// ranking re-sorted by SCORE, the transcript used turn order, the members page
// used the persona list. So the EU regulator was blue in one chart and amber in
// the next, and a reader comparing two charts of the same debate was misled.
//
// The fix is to key identity on the member id:
//
//   identity(id) = PALETTE[ sorted(ids).indexOf(id) % PALETTE.length ]
//
// Sorting is what makes it stable. Every caller resolves through the same
// registry, so the order a component iterates in stops mattering.
//
// THE SHAPE CHANNEL (why identity is a pair, not a colour)
// Every hex has to clear 3:1 against both a white matplotlib PNG and the app's
// dark surface (#16181C). That confines all six to a narrow mid-luminance band,
// so they are already close together — and at 7+ members the palette wraps and
// two people share a colour, in a product whose whole premise is per-member
// identity. So identity carries a second, non-colour channel: a stroke-dash
// pattern, assigned by the same pure function. It is inert at <=6 members and
// activates automatically past that. `palette.py` carries the same two lists in
// the same order, and Week 4's test suite fails if either drifts.

//: Six hexes, every one inside the luminance window 0.126-0.30 — the only band
//: that clears 3:1 against #FFFFFF (matplotlib PNGs) and against #16181C (app
//: dark surface). SHARED VERBATIM WITH palette.py. Changing one here is a
//: two-file change or nothing.
export const AGENT_PALETTE = [
  '#3B7DD8', // blue
  '#0E8F86', // teal
  '#B5761A', // ochre
  '#A8459B', // magenta
  '#4C8B2B', // green
  '#D1544B', // red
];

//: The second identity channel, same ordering and same determinism as the
//: palette. SVG stroke-dasharray values; `null` is a solid line. Only rendered
//: once a run has more members than the palette has colours — below that, two
//: channels for four members is noise pretending to be information.
export const AGENT_DASHES = [
  null,
  '6 3',
  '2 3',
  '9 3 2 3',
  '1 3',
  '12 4',
];

//: Past this many members the dash channel turns on, because the colour channel
//: has run out and started repeating.
export const SHAPE_CHANNEL_THRESHOLD = AGENT_PALETTE.length;

// FNV-1a, for an id the registry does not know. A plain string-length or
// charCode sum collides constantly on ids that share a prefix
// (`academic_researcher` / `academic_reviewer`); FNV-1a does not, and unlike a
// random assignment it gives the same colour on every render and every reload.
function hashIndex(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % AGENT_PALETTE.length;
}

/**
 * Build an identity registry for one debate.
 *
 * @param {string[]} ids every member in the discussion. Order is irrelevant —
 *   the registry sorts them, which is what makes two components agree.
 */
export function createAgentColors(ids) {
  const ordered = [...new Set((ids || []).filter((id) => typeof id === 'string' && id))].sort();
  const shapeOn = ordered.length > SHAPE_CHANNEL_THRESHOLD;

  const colorMap = {};
  const dashMap = {};
  ordered.forEach((id, index) => {
    colorMap[id] = AGENT_PALETTE[index % AGENT_PALETTE.length];
    // QUOTIENT, not remainder. The colour is `index % PALETTE.length`, so
    // members 0 and 6 share a colour; if the dash also used the remainder they
    // would share that too and the second channel would disambiguate nothing.
    // The quotient makes the (colour, dash) PAIR unique.
    dashMap[id] = shapeOn
      ? AGENT_DASHES[Math.floor(index / AGENT_PALETTE.length) % AGENT_DASHES.length]
      : null;
  });

  const indexOf = (id) => {
    const i = ordered.indexOf(id);
    return i === -1 ? hashIndex(id || '') : i;
  };

  return {
    map: colorMap,
    /** True when colour alone can no longer tell every member apart. */
    shapeChannelActive: shapeOn,
    colorFor(id) {
      if (!id) return AGENT_PALETTE[0];
      return colorMap[id] || AGENT_PALETTE[hashIndex(id)];
    },
    /** SVG stroke-dasharray for this member, or null for a solid stroke. */
    dashFor(id) {
      if (!id || !shapeOn) return null;
      if (dashMap[id] !== undefined) return dashMap[id];
      const i = indexOf(id);
      return AGENT_DASHES[Math.floor(i / AGENT_PALETTE.length) % AGENT_DASHES.length];
    },
    /** A tinted surface derived from the member's colour, for avatar fills. */
    washFor(id) {
      return `color-mix(in oklab, ${this.colorFor(id)} var(--wash), var(--surface))`;
    },
  };
}

//: The registry used when no run is loaded yet - pure hash, no assignment.
export const FALLBACK_AGENT_COLORS = createAgentColors([]);

/**
 * The colour for one member without a registry to hand.
 *
 * Prefer `useAgentColor()` inside a component: it resolves through the run's
 * registry, which gives distinct colours to every member of a normal council.
 * This is the escape hatch for code outside the React tree, and its colours can
 * collide when two ids happen to hash to the same slot.
 */
export function agentColorFor(id) {
  return FALLBACK_AGENT_COLORS.colorFor(id);
}

/** A translucent version of a colour, for fills and glows behind content. */
export function withAlpha(hex, alpha) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
