// One colour per member, the same colour in every chart on every page.
//
// WHY THIS FILE EXISTS
// Colour used to be `agentColor(index)`, where `index` was whatever position a
// member happened to occupy in whatever array the component was mapping over.
// Those arrays are not the same array:
//
//   OpinionTrajectory   Object.keys(analytics.opinion_change)
//   InfluenceRanking    the same members, re-sorted by SCORE
//   ChamberRing/Floor   run.meta.agents, in turn order
//   Members / seat      the persona list from the API
//
// So the EU regulator was blue in the trajectory, amber in the influence
// ranking, and teal on the members page - and a reader comparing two charts of
// the same debate was quietly misled about which line was whose.
//
// The fix is to key colour on the member id instead of on a position:
//
//   colour(id) = PALETTE[ sorted(ids).indexOf(id) % PALETTE.length ]
//
// Sorting is what makes it stable. Every caller resolves colour through the
// same registry, seeded once from the run's member list, so the order a
// particular component iterates in stops mattering. An id the registry has
// never seen - a member removed mid-run, or a chart rendered before the run
// metadata arrives - falls back to a hash of the id, so it still gets a fixed
// colour rather than none.
//
// PARITY WITH THE REPORT PNGs
// `src/visualization/palette.py` in the Week 4 analytics repo implements this
// same mapping over this same palette, so the charts rendered in the browser
// and the PNGs embedded in the committed report agree. Week 4's
// tests/test_palette.py reads the hex values out of THIS file and fails if the
// two lists drift, so change both in one commit.

//: Six hues, far apart from each other, every one clearing 3:1 against both a
//: white PNG canvas and this app's near-black dark surface (WCAG 1.4.11). The
//: measured ratios are documented in the Python twin. Keep in this order.
export const AGENT_PALETTE = [
  '#1f74e8', // blue
  '#c77700', // amber
  '#0d9488', // teal
  '#db2777', // magenta
  '#7c5cff', // violet
  '#22a94a', // green
];

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
 * Build a colour registry for one debate.
 *
 * @param {string[]} ids every member in the discussion. Order is irrelevant -
 *   the registry sorts them, which is what makes two components agree.
 * @returns {{ colorFor: (id: string) => string, map: Record<string,string> }}
 */
export function createAgentColors(ids) {
  const ordered = [...new Set((ids || []).filter((id) => typeof id === 'string' && id))].sort();
  const map = {};
  ordered.forEach((id, index) => {
    map[id] = AGENT_PALETTE[index % AGENT_PALETTE.length];
  });
  return {
    map,
    colorFor(id) {
      if (!id) return AGENT_PALETTE[0];
      return map[id] || AGENT_PALETTE[hashIndex(id)];
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
 * This function is the escape hatch for code outside the React tree, and its
 * colours can collide when two ids happen to hash to the same slot.
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
