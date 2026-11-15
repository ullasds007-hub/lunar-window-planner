// Thin client for the Lunar Window Planner FastAPI backend (same origin).
// BASE: '' when served at /app/, '/sim' when mounted at /sim/app/ inside another server.
export const BASE = location.pathname.replace(/\/app(\/.*)?$/, '');
export const u = (path) => BASE + path;
const cache = new Map();

async function getJSON(path, params = {}) {
  const url = u(path) + (Object.keys(params).length ? '?' + new URLSearchParams(params) : '');
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url).then(async (r) => {
    if (!r.ok) {
      let detail = r.statusText;
      try { detail = (await r.json()).detail || detail; } catch { /* not JSON */ }
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    return r.json();
  });
  cache.set(url, p);
  p.catch(() => cache.delete(url));
  return p;
}

/** Preset place id, or a custom place object {latitude_deg, longitude_deg, timezone}. */
export const placeQuery = (place) => (typeof place === 'string' ? { place }
  : { place: 'custom', lat: place.latitude_deg, lon: ((place.longitude_deg + 540) % 360) - 180, tz: place.timezone || 'UTC' });
const iso = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

export const api = {
  lunarSites: () => getJSON('/lunar-sites'),
  places: () => getJSON('/places'),
  // `site` is either a preset id or a query object from siteParams() (custom lat/lon)
  lunarSky: (site, startMs, endMs) => getJSON('/lunar-site/sky', { ...(typeof site === 'string' ? { site } : site), start: iso(startMs), end: iso(endMs) }),
  moonGeometry: (startMs, endMs, step = 60) =>
    getJSON('/moon/geometry', { start: iso(startMs), end: iso(endMs), step_minutes: step }),
  positions: (body, place, startMs, endMs, step = 5) =>
    getJSON(`/${body}/positions`, { ...placeQuery(place), start: iso(startMs) + 'Z', end: iso(endMs) + 'Z', step_minutes: step }),
  moonPhase: (ms) => getJSON('/moon/phase', { time: iso(ms) + 'Z' }),
  terrainMeta: (site) => getJSON('/assets/site/terrain.json', typeof site === 'string' ? { site } : site),
  terrainHeights: async (site) => {
    const r = await fetch(u('/assets/site/terrain.bin?') + new URLSearchParams(typeof site === 'string' ? { site } : site));
    if (!r.ok) throw new Error('terrain unavailable');
    return new Float32Array(await r.arrayBuffer());
  },
  terrainAlbedoUrl: (site) => u('/assets/site/albedo.png?') + new URLSearchParams(typeof site === 'string' ? { site } : site),
};
