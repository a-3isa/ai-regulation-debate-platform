// Makes one member's colour reachable from anywhere in the tree, so no
// component has to derive it from its own iteration order.
//
// The provider is seeded from every id the app knows about - the members on
// file plus the agents actually seated in the current run. Seeding from both
// matters: the members page renders before any run exists, and a past debate
// opened from the archive can contain a member that has since been deleted. A
// union of the two means both cases resolve to a real assigned colour instead
// of falling through to the hash.

import React, { createContext, useContext, useMemo } from 'react';

import { FALLBACK_AGENT_COLORS, createAgentColors } from './agentColors.js';

const AgentColorContext = createContext(FALLBACK_AGENT_COLORS);

export function AgentColorProvider({ ids, children }) {
  // `ids` is a fresh array on most renders, so memoise on its CONTENT rather
  // than its identity - otherwise every keystroke in the topic field rebuilds
  // the registry and re-renders every chart. Member ids are slugs, so a comma
  // cannot appear inside one and is safe as a separator.
  const key = (ids || []).filter(Boolean).slice().sort().join(',');
  const registry = useMemo(() => createAgentColors(ids), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return <AgentColorContext.Provider value={registry}>{children}</AgentColorContext.Provider>;
}

/** `colorFor(id)` for the current run. */
export function useAgentColors() {
  return useContext(AgentColorContext);
}

/** The colour for one member. */
export function useAgentColor(id) {
  return useContext(AgentColorContext).colorFor(id);
}
