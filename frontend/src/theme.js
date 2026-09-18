// Light / dark / follow-the-system, as a three-state preference.
//
// "Follow the system" is the default and a real option rather than an implied
// one: someone whose laptop switches to dark at sunset should not have to
// re-pick here, and someone who has deliberately chosen light while their OS is
// dark should keep it. That needs three states, not a boolean.
//
// The resolved theme is written to `data-theme` on <html>, which every token in
// App.css keys off, and mirrored into <meta name="theme-color"> so the browser
// chrome on iOS matches the page instead of flashing white.

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'council-theme';
export const THEMES = ['system', 'light', 'dark'];

function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function stored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(value) ? value : 'system';
  } catch {
    // Private browsing, or storage blocked. Following the system is the right
    // thing to do when we cannot remember a choice.
    return 'system';
  }
}

function apply(preference) {
  const resolved = preference === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : preference;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0b0b0d' : '#fbfbfd');
  return resolved;
}

export function useTheme() {
  const [preference, setPreference] = useState(stored);
  const [resolved, setResolved] = useState(() => apply(stored()));

  useEffect(() => {
    setResolved(apply(preference));
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      /* nothing to do - the preference just will not survive a reload */
    }
  }, [preference]);

  // Only while following the system: react to the OS flipping at sunset.
  useEffect(() => {
    if (preference !== 'system') return undefined;
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!query) return undefined;
    const onChange = () => setResolved(apply('system'));
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  const cycle = useCallback(() => {
    setPreference((prev) => THEMES[(THEMES.indexOf(prev) + 1) % THEMES.length]);
  }, []);

  return { preference, resolved, setPreference, cycle };
}
