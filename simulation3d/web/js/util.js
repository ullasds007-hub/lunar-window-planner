import * as THREE from 'three';

export const DEG = Math.PI / 180;

/** Moon-fixed lon/lat (deg, east-positive) -> point on a THREE.SphereGeometry of radius r.
 *  Matches SphereGeometry's UV layout with an equirectangular texture spanning lon -180..180. */
export function lonLatToVec(lonDeg, latDeg, r = 1, out = new THREE.Vector3()) {
  const u = ((((lonDeg + 180) % 360) + 360) % 360) / 360;
  const v = (latDeg + 90) / 180;
  const phi = u * Math.PI * 2;
  const theta = (1 - v) * Math.PI;
  return out.set(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
}

/** Local east/north/up basis at a lon/lat on the globe. */
export function localFrame(lonDeg, latDeg) {
  const up = lonLatToVec(lonDeg, latDeg).normalize();
  const e1 = lonLatToVec(lonDeg + 0.01, latDeg);
  const e0 = lonLatToVec(lonDeg - 0.01, latDeg);
  const east = e1.sub(e0).normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  return { up, east, north };
}

/** Azimuth (clockwise from north) and elevation (deg) -> direction in the ground scene
 *  (x = east, y = up, -z = north). */
export function azElToDir(azDeg, elDeg, out = new THREE.Vector3()) {
  const a = azDeg * DEG, e = elDeg * DEG;
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

/** Linear interpolation in an evenly sampled-or-not time series (ms timestamps). Angles unwrap if `angle`. */
export function sampleSeries(times, values, t, angle = false) {
  const n = times.length;
  if (!n) return NaN;
  if (t <= times[0]) return values[0];
  if (t >= times[n - 1]) return values[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; }
  const f = (t - times[lo]) / (times[hi] - times[lo]);
  let a = values[lo], b = values[hi];
  if (angle) {
    let d = ((b - a + 540) % 360) - 180;
    return (((a + d * f) % 360) + 360) % 360;
  }
  return a + (b - a) * f;
}

export function fmtUTC(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  const mon = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${p(d.getUTCDate())} ${mon} ${d.getUTCFullYear()} · ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export function fmtLocal(ms, tz) {
  return new Date(ms).toLocaleString('en-GB', {
    timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }) + ' ' + tzAbbr(ms, tz);
}

export function tzAbbr(ms, tz) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName').value;
  } catch { return tz; }
}

export function fmtCoord(lat, lon) {
  const ns = lat < 0 ? 'S' : 'N';
  return `${Math.abs(lat).toFixed(4)}°${ns}, ${(((lon % 360) + 360) % 360).toFixed(2)}°E`;
}

export const compassName = (az) =>
  ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((az % 360) + 360) % 360) / 45) % 8];

/** Tiny seeded PRNG for repeatable procedural detail. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
}
