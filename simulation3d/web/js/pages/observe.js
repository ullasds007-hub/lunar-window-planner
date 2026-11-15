import { api } from '../api.js';
import { state, setState } from '../state.js';
import { el, fmtLocal, sampleSeries, compassName } from '../util.js';
import { webglAvailable, loadingOverlay } from '../scene/common.js';
import { createSkyView, MOON_ENLARGE } from '../scene/skyView.js';
import { createTimeControl } from '../ui/timeControl.js';
import { createLocationPicker } from '../ui/locationPicker.js';

const SPEEDS = [
  { label: '5 min / s', hoursPerSecond: 1 / 12 },
  { label: '20 min / s', hoursPerSecond: 1 / 3 },
  { label: '1 h / s', hoursPerSecond: 1 },
];

/** UTC ms for a wall-clock time in an IANA zone. */
function zonedToUtc(y, m, d, hh, mm, tz) {
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    guess += Date.UTC(y, m - 1, d, hh, mm) - shown;
  }
  return guess;
}

function localDate(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const skyLabel = (alt) => alt > -0.833 ? 'Day' : alt > -6 ? 'Civil twilight' : alt > -12 ? 'Nautical twilight' : alt > -18 ? 'Astronomical twilight' : 'Dark';

export async function mount(root, params = new URLSearchParams()) {
  const engine = 'planner';
  const firstNight = params.get('date'), lastNight = params.get('end') || params.get('date');
  const places = await api.places();
  const byId = Object.fromEntries(places.map((p) => [p.id, p]));
  // a searched / device / map location (remembered per viewer)
  const latQ = Number(params.get('lat')), lonQ = Number(params.get('lon'));
  if (params.has('lat') && params.has('lon') && Number.isFinite(latQ) && Number.isFinite(lonQ)) {
    byId.custom = { id: 'custom', name: params.get('name') || 'Custom location', latitude_deg: latQ, longitude_deg: lonQ,
      timezone: params.get('tz') || 'UTC', elevation_m: 0 };
    state.place = 'custom';
  } else if (state.customPlace) byId.custom = state.customPlace;
  if (!byId[state.place]) state.place = places[0].id;
  const customOption = () => byId.custom ? el('option', { value: 'custom' }, `◎ ${byId.custom.name}`) : null;

  const placeSel = el('select', { 'aria-label': 'Preset location' }, customOption(), places.map((p) => el('option', { value: p.id }, p.name)));
  placeSel.value = state.place;
  const picker = createLocationPicker({
    place: byId[state.place],
    onPick: (pl) => {
      byId.custom = pl;
      setState({ place: 'custom', customPlace: pl });
      placeSel.querySelector('option[value="custom"]')?.remove();
      placeSel.prepend(customOption());
      placeSel.value = 'custom';
      if (!dateIn.value) dateIn.value = localDate(Date.now(), pl.timezone);
      loadNight('custom', dateIn.value);
    },
  });
  const dateIn = el('input', { type: 'date', 'aria-label': 'Night of (local date)' });
  const followBtn = el('button', { class: 'btn', type: 'button', 'aria-pressed': 'true' }, 'Follow the Moon');
  const nowBtn = el('button', { class: 'btn', type: 'button' }, 'Tonight');
  const goalSel = el('select', { 'aria-label': 'Observation goal' },
    el('option', { value: 'moon_viewing', selected: params.get('goal') !== 'dark_sky' }, 'Moon viewing'),
    el('option', { value: 'dark_sky', selected: params.get('goal') === 'dark_sky' }, 'Dark sky'));
  const prevBtn = el('button', { class: 'btn icon', type: 'button', 'aria-label': 'Previous night', title: 'Previous night' }, '‹');
  const nextBtn = el('button', { class: 'btn icon', type: 'button', 'aria-label': 'Next night', title: 'Next night' }, '›');
  // planner windows band (the planner's own rule: Moon >= 10 deg & Sun <= -6 deg, or Moon < 0 & Sun <= -18 deg)
  const bandTitle = el('span', { class: 'eyebrow' });
  const bandTrack = el('div', { class: 'ib-track', style: 'height:12px' });
  const bandCursor = el('div', { class: 'ib-cursor', 'aria-hidden': 'true' });
  const bandText = el('div', { class: 'small', 'aria-live': 'polite' });
  const bandSrc = el('div', { class: 'small muted' });
  const band = el('div', { class: 'planner-band' },
    el('div', { class: 'ib-head' }, bandTitle, bandText),
    el('div', { style: 'position:relative;margin:8px 0 6px' }, bandTrack, bandCursor), bandSrc);
  const stageBox = el('div', { class: 'stage' });
  const readout = el('div', { class: 'readout panel', 'aria-live': 'off' });
  const phaseBox = el('div', { class: 'tag panel', style: 'left:auto;right:14px;top:14px;position:absolute;z-index:2;display:grid;gap:2px;padding:10px 12px;font-size:12.5px' });
  stageBox.append(readout, phaseBox,
    el('div', { class: 'scene-caption' }, `Moon drawn ${MOON_ENLARGE}× its true size · lit from the true Sun direction · star field illustrative`));
  const timebarHost = el('div');

  root.append(el('section', { class: 'page observe' },
    el('div', { class: 'controls' },
      el('div', { class: 'param', style: 'margin-right:auto' }, el('div', { class: 'eyebrow' }, 'Earth · ground level · local time'), el('h1', { style: 'font-size:28px;margin:6px 0 0' }, 'Observe from Earth')),
      el('label', { class: 'field param' }, 'Location', placeSel),
      el('label', { class: 'field param' }, 'Goal', goalSel),
      el('div', { class: 'night-nav' }, el('span', { class: 'param' }, prevBtn), el('label', { class: 'field param' }, 'Night of', dateIn), el('span', { class: 'param' }, nextBtn), el('span', { class: 'embed-night mono small' })),
      el('span', { class: 'param' }, nowBtn), followBtn),
    el('div', { class: 'param' }, picker.node), stageBox, timebarHost, band));

  if (!webglAvailable()) {
    stageBox.append(el('div', { class: 'fallback' }, el('div', { class: 'note' }, '3D view unavailable · the readouts below still update with time')));
  }
  const sky = webglAvailable() ? createSkyView(stageBox, { latDeg: byId[state.place].latitude_deg }) : null;
  sky?.onFollowChange((on) => followBtn.setAttribute('aria-pressed', String(on)));
  followBtn.addEventListener('click', () => { sky?.follow(true); followBtn.setAttribute('aria-pressed', 'true'); });

  let ctl = null, data = null, alive = true, loading = null, phaseRef = null;

  async function loadNight(placeId, ymd, keepClock) {
    const p = byId[placeId];
    const [y, m, d] = ymd.split('-').map(Number);
    const start = zonedToUtc(y, m, d, 12, 0, p.timezone);
    const end = start + 24 * 3600e3;
    loading?.done(); loading = sky ? loadingOverlay(stageBox, 'Computing Moon and Sun positions…') : null;
    try {
      const [mo, su, ph] = await Promise.all([
        api.positions('moon', placeId === 'custom' ? p : placeId, start, end, 5), api.positions('sun', placeId === 'custom' ? p : placeId, start, end, 5),
        api.moonPhase(start + 12 * 3600e3)]);
      data = { p, start, end, t: mo.times_utc.map((x) => Date.parse(x)), moon: mo, sun: su };
      phaseRef = { t: start + 12 * 3600e3, cycle: ph.phase_cycle_deg };   // phase advances ~12.19 deg/day
      sky?.setLatitude(p.latitude_deg);
      picker.setPlace(p);
      // default clock: 21:00 local, or keep the previous local time-of-night
      const t0 = keepClock ?? zonedToUtc(y, m, d, 21, 0, p.timezone);
      ctl?.dispose();
      ctl = createTimeControl({ start, end, time: Math.min(end, Math.max(start, t0)), speeds: SPEEDS, speedIndex: 1,
        format: (ms) => fmtLocal(ms, p.timezone), label: 'Local time of night' });
      timebarHost.replaceChildren(ctl.node);
      ctl.onTime((t) => update(t));
      loading?.done();
      const tag = root.querySelector('.embed-night');
      if (tag) tag.textContent = `${p.name.replace(/^(India|USA) - /, '')} · night of ${ymd} · ${goalSel.selectedOptions[0].textContent}`;
      loadWindows();
    } catch (e) {
      loading?.error('Positions unavailable: ' + e.message);
    }
  }

  // ---- the planner's qualifying windows for this night -------------------------------------------------
  let windows = [], plannerCache = new Map();
  const goalText = () => (goalSel.value === 'dark_sky' ? 'Dark-sky windows' : 'Moon-viewing windows');
  async function loadWindows() {
    if (!data) return;
    const ymd = dateIn.value, src = [];
    windows = [];
    if (engine === 'planner' && (placeSel.value === 'mysuru' || placeSel.value === 'custom')) {
      const pl = data.p;
      const loc = placeSel.value === 'mysuru' ? { locationId: 'mysuru' }
        : { locationId: 'custom', lat: pl.latitude_deg, lon: ((pl.longitude_deg + 540) % 360) - 180, tz: pl.timezone };
      const key = `${goalSel.value}|${ymd}|${JSON.stringify(loc)}`;
      try {
        if (!plannerCache.has(key)) {
          const r = await fetch('/windows?' + new URLSearchParams({ ...loc, startDate: ymd, endDate: ymd, goal: goalSel.value }));
          const body = await r.json();
          if (body.status !== 'ok') throw new Error(body.error?.message || 'planner error');
          plannerCache.set(key, body.result.windows.map((w) => [Date.parse(w.start), Date.parse(w.end)]));
        }
        windows = plannerCache.get(key);
        src.push('Earth Observation Planner engine (/windows)');
      } catch (e) { src.push('Planner windows unavailable: ' + e.message); }
    } else {
      // same rule as the planner, applied to this view's 5-minute positions
      const ok = (i) => goalSel.value === 'dark_sky'
        ? data.moon.altitude_deg[i] < 0 && data.sun.altitude_deg[i] <= -18
        : data.moon.altitude_deg[i] >= 10 && data.sun.altitude_deg[i] <= -6;
      let open = null;
      data.t.forEach((t, i) => { if (ok(i) && open == null) open = t; if (!ok(i) && open != null) { windows.push([open, t]); open = null; } });
      if (open != null) windows.push([open, data.end]);
      src.push('Planner rule applied to Skyfield positions (5-min steps)');
    }
    bandTitle.textContent = `${goalText()} · ${dateIn.value}`;
    const span = data.end - data.start;
    bandTrack.replaceChildren(...windows.map(([a, b]) => el('span', { style: `left:${(100 * (a - data.start)) / span}%;width:${Math.max(0.3, (100 * (b - a)) / span)}%;background:var(--c-sun)` })));
    bandSrc.textContent = 'Source: ' + src.join(' · ') + (goalSel.value === 'dark_sky'
      ? ' · rule: Moon below horizon and Sun ≤ −18°' : ' · rule: Moon ≥ 10° and Sun ≤ −6°');
    if (ctl) update(ctl.time);
  }
  const fmtHM = (ms) => fmtLocal(ms, data.p.timezone).split(', ').pop().replace(/ [A-Z+0-9:]+$/, '');

  const NAMES = ['New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous', 'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent'];
  function phaseNameAt(t) {
    if (!phaseRef) return '';
    const cyc = ((phaseRef.cycle + (t - phaseRef.t) / 86400e3 * 12.19) % 360 + 360) % 360;
    // same convention as the backend: principal phases within +-7.5 deg of their exact instant
    for (const [c, n] of [[0, 'New Moon'], [90, 'First Quarter'], [180, 'Full Moon'], [270, 'Last Quarter'], [360, 'New Moon']])
      if (Math.abs(cyc - c) <= 7.5) return n;
    return cyc < 90 ? NAMES[1] : cyc < 180 ? NAMES[3] : cyc < 270 ? NAMES[5] : NAMES[7];
  }

  function update(t) {
    if (!data) return;
    const { moon, sun } = data;
    const s = {
      moonAlt: sampleSeries(data.t, moon.altitude_deg, t), moonAz: sampleSeries(data.t, moon.azimuth_deg, t, true),
      sunAlt: sampleSeries(data.t, sun.altitude_deg, t), sunAz: sampleSeries(data.t, sun.azimuth_deg, t, true),
      illumination: sampleSeries(data.t, moon.illumination_percent, t), ms: t, lonDeg: data.p.longitude_deg,
    };
    sky?.setSky(s);
    readout.replaceChildren(
      el('span', { class: 'k' }, 'Moon'), el('span', { class: 'v' }, `${s.moonAlt.toFixed(1)}° up · ${s.moonAz.toFixed(0)}° ${compassName(s.moonAz)}${s.moonAlt < 0 ? ' (below horizon)' : ''}`),
      el('span', { class: 'k' }, 'Sun'), el('span', { class: 'v' }, `${s.sunAlt.toFixed(1)}° · ${skyLabel(s.sunAlt)}`),
      el('span', { class: 'k' }, 'Place'), el('span', { class: 'v' }, `${data.p.name.replace(/^(India|USA) - /, '')} · ${data.p.latitude_deg.toFixed(4)}°, ${data.p.longitude_deg.toFixed(4)}°`));
    if (data) {
      bandCursor.style.left = `${(100 * (t - data.start)) / (data.end - data.start)}%`;
      const inside = windows.some(([a, b]) => t >= a && t <= b);
      bandText.textContent = windows.length
        ? `${windows.map(([a, b]) => `${fmtHM(a)}–${fmtHM(b)} (${Math.round((b - a) / 60000)} min)`).join(' · ')} · now ${inside ? 'inside ✓' : 'outside'}`
        : 'No qualifying window this night';
    }
    phaseBox.replaceChildren(
      el('span', { class: 'eyebrow' }, 'Phase'),
      el('strong', {}, phaseNameAt(t)), el('span', { class: 'mono' }, `${s.illumination.toFixed(1)} % lit`));
  }

  const today = localDate(Date.now(), (byId[state.place] || places[0]).timezone);
  dateIn.value = firstNight || state.observeDate || today;
  if (params.get('place') && byId[params.get('place')]) placeSel.value = params.get('place');
  const shiftNight = (days) => {
    const d = new Date(dateIn.value + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days);
    const v = d.toISOString().slice(0, 10);
    if (firstNight && (v < firstNight || v > lastNight)) return;   // stay inside the planner's range
    dateIn.value = v; setState({ observeDate: v }); loadNight(placeSel.value, v);
  };
  prevBtn.addEventListener('click', () => shiftNight(-1));
  nextBtn.addEventListener('click', () => shiftNight(1));
  goalSel.addEventListener('change', loadWindows);
  placeSel.addEventListener('change', () => { setState({ place: placeSel.value }); loadNight(placeSel.value, dateIn.value); });
  if (params.get('place') === 'custom' && byId.custom) placeSel.value = 'custom';
  dateIn.addEventListener('change', () => { if (dateIn.value) { setState({ observeDate: dateIn.value }); loadNight(placeSel.value, dateIn.value); } });
  nowBtn.addEventListener('click', () => {
    dateIn.value = localDate(Date.now(), byId[placeSel.value].timezone);
    setState({ observeDate: dateIn.value });
    loadNight(placeSel.value, dateIn.value);
  });
  await loadNight(placeSel.value, dateIn.value);

  let last = performance.now();
  const loop = (now) => {
    if (!alive) return;
    ctl?.tick(Math.min(0.1, (now - last) / 1000)); last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return { unmount() { alive = false; ctl?.dispose(); sky?.dispose(); } };
}
