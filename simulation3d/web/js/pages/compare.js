import { state, sites, setState, DEFAULT_TIME, DATA_START, DATA_END } from '../state.js';
import { el, fmtCoord, fmtUTC, sampleSeries, compassName } from '../util.js';
import { webglAvailable, loadingOverlay, staticFallback } from '../scene/common.js';
import { createTerrainView } from '../scene/terrainView.js';
import { createTimeControl } from '../ui/timeControl.js?v=linked-clocks-1';
import { createIntervalBars } from '../ui/intervalBars.js?v=short-durations-1';
import { skyTrack, intervals, siteParams, ENGINE_LABEL } from '../lunarData.js';
import { u } from '../api.js';

const SPEEDS = [
  { label: '30 min / s', hoursPerSecond: 0.5 },
  { label: '2 h / s', hoursPerSecond: 2 },
  { label: '6 h / s', hoursPerSecond: 6 },
  { label: '1 day / s', hoursPerSecond: 24 },
];

/** "lat,lon" or a preset id -> site object */
function parseSite(v, letter) {
  if (!v) return null;
  const m = v.split(',').map(Number);
  if (m.length === 2 && m.every(Number.isFinite)) {
    const preset = sites.list.find((s) => Math.abs(s.lat - m[0]) < 1e-4 && Math.abs((((s.lon - m[1]) % 360) + 540) % 360 - 180) < 1e-4);
    return preset ? { ...preset, preset: true } : { id: `custom-${letter}`, name: `Scenario ${letter}`, lat: m[0], lon: m[1], preset: false };
  }
  const s = sites.byId[v];
  return s ? { ...s, preset: true } : null;
}
const presetSite = (id) => ({ ...sites.byId[id], preset: true });

function compassSVG() {
  return el('div', { class: 'compass panel', 'aria-hidden': 'true', html: `
    <svg viewBox="-50 -50 100 100">
      <circle r="40" fill="none" stroke="rgba(255,255,255,.18)"/>
      <path class="fov" d="" fill="rgba(255,255,255,.07)"/>
      <text y="-43" text-anchor="middle" font-size="9" fill="#9aa1ab" font-family="Inter">N</text>
      <circle class="sun" r="4.5" fill="#f0c27a"/>
      <circle class="earth" r="4" fill="#8db4d8"/>
    </svg>` });
}
function updateCompass(node, { sunAz, sunEl, earthAz, earthEl, yaw }) {
  const pos = (az) => [Math.sin(az * Math.PI / 180) * 40, -Math.cos(az * Math.PI / 180) * 40];
  const [sx, sy] = pos(sunAz), [ex, ey] = pos(earthAz);
  const s = node.querySelector('.sun'), e = node.querySelector('.earth');
  s.setAttribute('cx', sx); s.setAttribute('cy', sy); s.setAttribute('opacity', sunEl > 0 ? 1 : 0.35);
  e.setAttribute('cx', ex); e.setAttribute('cy', ey); e.setAttribute('opacity', earthEl > 0 ? 1 : 0.35);
  const a0 = (yaw - 26) * Math.PI / 180, a1 = (yaw + 26) * Math.PI / 180;
  node.querySelector('.fov').setAttribute('d', `M0 0 L${Math.sin(a0) * 40} ${-Math.cos(a0) * 40} A40 40 0 0 1 ${Math.sin(a1) * 40} ${-Math.cos(a1) * 40} Z`);
}

export async function mount(root, params = new URLSearchParams()) {
  // ---- scenario from the planner (or defaults) --------------------------------------------------
  const engine = 'planner';
  const pDate = (k) => { const v = params.get(k); const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
  const startA = pDate('startA') ?? pDate('start'), endA = pDate('endA') ?? pDate('end');
  const startB = pDate('startB') ?? startA, endB = pDate('endB') ?? endA;
  const fromPlanner = !!(startA && endA);
  const scen = {
    A: { site: parseSite(params.get('a'), 'A') ?? presetSite(sites.byId[state.compareA] ? state.compareA : sites.list[0].id),
      start: fromPlanner ? startA : DATA_START, end: fromPlanner ? endA : DATA_END },
    B: { site: parseSite(params.get('b'), 'B') ?? presetSite(sites.byId[state.compareB] ? state.compareB : sites.list[1].id),
      start: fromPlanner ? startB : DATA_START, end: fromPlanner ? endB : DATA_END },
  };
  const sameRange = scen.A.start === scen.B.start && scen.A.end === scen.B.end;

  // ---- controls ---------------------------------------------------------------------------------
  const customs = { A: scen.A.site.preset ? null : scen.A.site, B: scen.B.site.preset ? null : scen.B.site };
  const siteOptions = (letter) => {
    const cur = scen[letter].site;
    const opts = sites.list.map((s) => el('option', { value: s.id, selected: cur.preset && s.id === cur.id }, s.name));
    if (customs[letter]) opts.unshift(el('option', { value: customs[letter].id, selected: !cur.preset }, `${customs[letter].name} · ${fmtCoord(customs[letter].lat, customs[letter].lon)}`));
    return opts;
  };
  const selA = el('select', { 'aria-label': 'Site A' }, siteOptions('A'));
  const selB = el('select', { 'aria-label': 'Site B' }, siteOptions('B'));
  const facing = el('select', { 'aria-label': 'Camera direction' },
    el('option', { value: 'earth' }, 'Face Earth'), el('option', { value: 'sun' }, 'Face the Sun'), el('option', { value: 'north' }, 'Face north'));

  // only=A|B: a single scenario in its own space (the host page shows A and B in separate panels)
  const only = ['A', 'B'].includes(params.get('only')) ? params.get('only') : null;
  const letters = only ? [only] : ['A', 'B'];
  const lead = only || 'A';
  const duo = el('div', { class: only ? 'duo solo' : 'duo' });
  const bars = { A: createIntervalBars({ title: 'Scenario A · calculated timeline' }), B: createIntervalBars({ title: 'Scenario B · calculated timeline' }) };
  const duoBars = el('div', { class: only ? 'duo-bars solo' : 'duo-bars' }, ...letters.map((l) => el('div', {}, bars[l].node)));

  // clock over the lead scenario's range; the other follows at the same relative progress (as in the planner)
  const L = scen[lead];
  const t0 = Math.min(L.end, Math.max(L.start, fromPlanner ? L.start : (state.lunarTime ?? DEFAULT_TIME)));
  const ctl = createTimeControl({ start: L.start, end: L.end, time: t0, speeds: SPEEDS, speedIndex: 1,
    label: only ? `Scenario ${only} time (UTC)` : sameRange ? 'Scenario time (UTC)' : 'Scenario A time (UTC); B moves at the same relative progress' });
  const timeFor = (letter, tL) => letter === lead ? tL
    : scen[letter].start + ((tL - L.start) / (L.end - L.start)) * (scen[letter].end - scen[letter].start);

  root.append(el('section', { class: 'page' },
    el('div', { class: 'compare-head param' },
      el('div', {},
        el('div', { class: 'eyebrow' }, fromPlanner ? 'Lunar surface · scenarios from the planner · UTC' : 'Lunar surface · ground level · UTC'),
        el('h1', {}, 'Compare landing sites'),
        el('p', { class: 'muted small', style: 'margin:6px 0 0' },
          sameRange ? `${fmtUTC(scen.A.start)} → ${fmtUTC(scen.A.end)} · same clock for both views. Drag a view to look around.`
            : `A: ${fmtUTC(scen.A.start)} → ${fmtUTC(scen.A.end)} · B: ${fmtUTC(scen.B.start)} → ${fmtUTC(scen.B.end)} · same relative progress.`)),
      el('div', { class: 'controls' },
        el('label', { class: 'field' }, 'Site A', selA),
        el('label', { class: 'field' }, 'Site B', selB),
        el('label', { class: 'field' }, 'Camera', facing))),
    duo, ctl.node, duoBars,
    el('div', { class: 'legend-line' },
      el('span', {}, el('span', { class: 'site-dot', style: 'background:#f0c27a' }), ' Sun'),
      el('span', {}, el('span', { class: 'site-dot', style: 'background:#8db4d8;box-shadow:none' }), ' Earth'),
      el('span', {}, `Sun/Earth: ${ENGINE_LABEL[engine]}`),
      el('span', {}, 'Terrain is illustrative; the label on each view identifies its source.'))));

  const has3D = webglAvailable();
  const panels = [];

  async function buildPanel(letter) {
    const sc = scen[letter], s = sc.site;
    const box = el('div', { class: 'view' });
    const timeTag = el('span', { class: 't' });
    const tag = el('div', { class: 'tag panel' }, el('span', { class: 'letter' }, letter), el('span', {}, s.name), el('span', { class: 'c' }, fmtCoord(s.lat, s.lon)), timeTag);
    const readout = el('div', { class: 'readout panel', 'aria-live': 'off' });
    const compass = compassSVG();
    const nightNote = el('div', { class: 'night-note panel', hidden: true }, 'Visualization light on · terrain lighting is illustrative');
    box.append(tag, readout, compass, nightNote, el('div', { class: 'hint panel' }, 'Drag to look around'));
    const p = { letter, sc, box, readout, compass, timeTag, nightNote, view: null, sky: null };
    const loading = loadingOverlay(box, `Loading terrain · ${s.name}`);
    if (has3D) p.view = createTerrainView(box, { siteId: siteParams(s), shadowSize: 1024, onError: () => loading.error('Ground view could not start. The timeline and elevation data are still available.') });
    else staticFallback(box, u('/assets/site/albedo.png?') + new URLSearchParams(siteParams(s)), 'LROC WAC map around the site');
    try {
      p.sky = await skyTrack(s, sc.start, sc.end, engine);
    } catch (e) { loading.error('Sun/Earth data unavailable: ' + e.message); }
    if (p.view) p.view.ready.then(() => loading.done()).catch(() => {}); else loading.done();
    intervals(s, sc.start, sc.end, engine, p.sky)
      .then((r) => { bars[letter].set(r.rows, sc.start, sc.end, r.source); bars[letter].cursor(timeFor(letter, ctl.time)); })
      .catch((e) => bars[letter].setError('Intervals unavailable: ' + e.message));
    return p;
  }

  const skyAt = (p, t) => ({
    sunAz: sampleSeries(p.sky.t, p.sky.sun_az, t, true), sunEl: sampleSeries(p.sky.t, p.sky.sun_el, t),
    earthAz: sampleSeries(p.sky.t, p.sky.earth_az, t, true), earthEl: sampleSeries(p.sky.t, p.sky.earth_el, t),
  });
  function aim(p, tA) {
    if (!p.view || !p.sky) return;
    const s = skyAt(p, timeFor(p.letter, tA));
    p.view.setHeading(facing.value === 'earth' ? s.earthAz : facing.value === 'sun' ? s.sunAz : 0);
  }
  const row = (k, v, up) => [el('span', { class: 'k' }, k), el('span', { class: 'v' }, v), el('span', { class: 's ' + (up ? 'state-yes' : 'state-no') }, up ? 'above horizon' : 'at or below horizon')];
  function update(tA) {
    for (const p of panels) {
      const t = timeFor(p.letter, tA);
      bars[p.letter].cursor(t);
      p.timeTag.textContent = sameRange ? '' : fmtUTC(t);
      if (!p.sky) continue;
      const s = skyAt(p, t);
      p.view?.setSky(s);
      p.nightNote.hidden = !(p.view && p.view.view.visFill);
      const sunUp = s.sunEl > 0, earthUp = s.earthEl > 0;
      p.readout.replaceChildren(
        ...row('Sun', `${s.sunEl.toFixed(2)}° · ${s.sunAz.toFixed(0)}° ${compassName(s.sunAz)}`, sunUp),
        ...row('Earth', `${s.earthEl.toFixed(2)}° · ${s.earthAz.toFixed(0)}° ${compassName(s.earthAz)}`, earthUp),
        el('span', { class: 'both ' + (sunUp && earthUp ? 'state-yes' : 'state-no') },
          sunUp && earthUp ? 'Sun and Earth both above the horizon' : 'Not both above the horizon'));
      updateCompass(p.compass, { ...s, yaw: p.view ? p.view.view.yaw : 0 });
    }
  }

  async function rebuild() {
    panels.splice(0).forEach((p) => p.view?.dispose());
    duo.replaceChildren();
    const built = await Promise.all(letters.map((l) => buildPanel(l)));
    panels.push(...built);
    duo.append(...built.map((x) => x.box));
    panels.forEach((p) => aim(p, ctl.time));
    update(ctl.time);
  }
  const pick = (letter, sel) => {
    const v = sel.value;
    scen[letter].site = customs[letter] && v === customs[letter].id ? customs[letter] : presetSite(v);
    if (scen[letter].site.preset) setState({ [letter === 'A' ? 'compareA' : 'compareB']: v });
    rebuild();
  };
  selA.addEventListener('change', () => pick('A', selA));
  selB.addEventListener('change', () => pick('B', selB));
  facing.addEventListener('change', () => panels.forEach((p) => aim(p, ctl.time)));

  await rebuild();
  ctl.onTime((t, src) => {
    update(t);
    if (src !== 'play' && !fromPlanner) setState({ lunarTime: t });
  });

  // Only one panel advances the linked clock. User actions in either panel
  // can take control; received snapshots never generate outgoing actions.
  const embedded = only && window.parent !== window;
  let following = false;
  const post = (kind) => {
    if (embedded) window.parent.postMessage({ type: 'lwp:clock', kind, from: only,
      p: (ctl.time - L.start) / (L.end - L.start), playing: ctl.playing, speed: ctl.speed }, location.origin);
  };
  ctl.onAction(() => { following = false; post('action'); });
  const onMsg = (e) => {
    if (!embedded || e.origin !== location.origin || e.source !== window.parent || !e.data) return;
    const { type, p, playing, speed } = e.data;
    if (type === 'lwp:clock-detach') { following = false; return; }
    if (type === 'lwp:clock-request') { following = false; post('tick'); return; }
    if (!['lwp:clock-follow', 'lwp:clock-lead'].includes(type) || !Number.isFinite(p) || typeof playing !== 'boolean') return;
    following = type === 'lwp:clock-follow';
    ctl.setSpeed(speed);
    ctl.follow(L.start + Math.min(1, Math.max(0, p)) * (L.end - L.start), playing);
  };
  window.addEventListener('message', onMsg);
  post('ready');

  let alive = true, last = performance.now();
  const loop = (now) => {
    if (!alive) return;
    if (!following && ctl.playing) {
      ctl.tick(Math.min(0.1, (now - last) / 1000));
      post('tick');  // includes the stopped state at the end of the range
    }
    last = now;
    for (const p of panels) if (p.sky) updateCompass(p.compass, { ...skyAt(p, timeFor(p.letter, ctl.time)), yaw: p.view ? p.view.view.yaw : 0 });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return { unmount() { alive = false; window.removeEventListener('message', onMsg); ctl.dispose(); panels.forEach((p) => p.view?.dispose()); } };
}
