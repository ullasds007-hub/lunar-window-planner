// Lunar-surface data providers for the 3D views.
//
// engine 'planner'  : the Lunar Window Planner's own calculation module (served by the parent app at
//                     /lunar-surface): surface-sky (Sun/Earth az/el), surface-geometry (sub-solar and
//                     sub-Earth points) and surface-windows (sunlight / darkness / Earth / both intervals).
//                     Smooth horizon, Skyfield DE440s + MOON_ME_DE421 frame. Any lat/lon, 1901-2049.
// engine 'horizons' : this simulation's own data API (JPL Horizons exports / live API).
import { api } from './api.js';

const PLANNER = '/lunar-surface';
const isoZ = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const lon180 = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

export const ENGINE_LABEL = {
  planner: 'Lunar Window Planner engine (Skyfield DE440s, MOON_ME_DE421 frame, smooth horizon)',
  horizons: 'JPL Horizons (observer on the Moon, smooth horizon)',
};

/** Query parameters identifying a site for this simulation's own API (preset id or custom lat/lon). */
export function siteParams(site) {
  return site.preset ? { site: site.id } : { site: 'custom', lunar_lat: site.lat, lunar_lon: ((site.lon % 360) + 360) % 360 };
}

async function planner(path, params) {
  const r = await fetch(PLANNER + path + '?' + new URLSearchParams(params));
  let body = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new Error(body && typeof body.detail === 'string' ? body.detail : `Planner engine error (${r.status})`);
  return body;
}

/** Hourly Sun/Earth azimuth/elevation over [start, end] -> { t[], sun_az[], sun_el[], earth_az[], earth_el[], source } */
export async function skyTrack(site, start, end, engine) {
  if (engine === 'planner') {
    const d = await planner('/surface-sky', { lat: site.lat, lon: lon180(site.lon), start: isoZ(start), end: isoZ(end) });
    return { t: d.times.map(Date.parse), sun_az: d.sun_az, sun_el: d.sun_el, earth_az: d.earth_az, earth_el: d.earth_el, source: ENGINE_LABEL.planner };
  }
  const d = await api.lunarSky(siteParams(site), start, end);
  return { t: d.times_utc.map(Date.parse), sun_az: d.sun_az, sun_el: d.sun_el, earth_az: d.earth_az, earth_el: d.earth_el,
    source: `${ENGINE_LABEL.horizons} · ${d.data_source.sun}` };
}

/** Sub-solar / sub-Earth points for lighting the globe -> { t[], sub_solar_lon[], ... , source } */
export async function moonGeometry(start, end, engine) {
  if (engine === 'planner') {
    const g = await planner('/surface-geometry', { start: isoZ(start), end: isoZ(end) });
    return { ...g, t: g.times.map(Date.parse), source: ENGINE_LABEL.planner };
  }
  const g = await api.moonGeometry(start, end, 60);
  return { ...g, t: g.times.map(Date.parse), source: 'JPL Horizons (sub-solar / sub-Earth points)' };
}

/** Interval rows [sunlight, darkness, earth, both] as [[startMs, endMs], ...].
 *  Planner engine: its exact surface-windows result. Otherwise: from the hourly track (interpolated crossings). */
export async function intervals(site, start, end, engine, track) {
  if (engine === 'planner') {
    const d = await planner('/surface-windows', { lat: site.lat, lon: lon180(site.lon), start: isoZ(start), end: isoZ(end) });
    return { rows: d.rows.map((row) => row.map(([a, b]) => [Date.parse(a), Date.parse(b)])), source: ENGINE_LABEL.planner };
  }
  return { rows: rowsFromTrack(track, start, end), source: 'From the hourly track (linear interpolation of 0° crossings)' };
}

function rowsFromTrack(k, start, end) {
  const rows = [[], [], [], []];
  const push = (row, a, b) => { if (b <= a) return; const r = rows[row]; if (r.length && r[r.length - 1][1] === a) r[r.length - 1][1] = b; else r.push([a, b]); };
  const step = 10 * 60e3;
  const val = (arr, t) => { // linear interpolation
    const ts = k.t; if (t <= ts[0]) return arr[0]; if (t >= ts[ts.length - 1]) return arr[arr.length - 1];
    let lo = 0, hi = ts.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; }
    return arr[lo] + (arr[hi] - arr[lo]) * (t - ts[lo]) / (ts[hi] - ts[lo]);
  };
  for (let a = start; a < end; a += step) {
    const b = Math.min(end, a + step), m = (a + b) / 2;
    const sun = val(k.sun_el, m) > 0, earth = val(k.earth_el, m) > 0;
    if (sun) push(0, a, b); else push(1, a, b);
    if (earth) push(2, a, b);
    if (sun && earth) push(3, a, b);
  }
  return rows;
}
