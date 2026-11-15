// Shared app state: selected landing site and the lunar scenario time.
// Persisted per viewer in localStorage (convenience only; safe if storage is unavailable).

const KEY = 'lwp.state.v1';
const listeners = new Set();

// Demo scenario inside the saved, verified Horizons exports (Dec 2026).
export const DEFAULT_TIME = Date.parse('2026-12-14T20:00:00Z');
export const DATA_START = Date.parse('2026-12-01T00:00:00Z');
export const DATA_END = Date.parse('2026-12-31T00:00:00Z');

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export const state = Object.assign({
  site: 'site04',
  compareA: 'site04',
  compareB: 'site11',
  lunarTime: DEFAULT_TIME,
  place: 'sriharikota_slp',
}, load());

export const sites = { list: [], byId: {} };

export function setState(patch) {
  Object.assign(state, patch);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  listeners.forEach((fn) => fn(state, patch));
}

export function onState(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
