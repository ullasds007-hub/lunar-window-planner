import { u } from '../api.js';
import { state, sites, setState, DEFAULT_TIME, DATA_START, DATA_END } from '../state.js';
import { el, fmtCoord, fmtUTC, sampleSeries, compassName } from '../util.js';
import { webglAvailable, loadingOverlay, staticFallback } from '../scene/common.js';
import { createMoonGlobe } from '../scene/moonGlobe.js';
import { createTerrainView } from '../scene/terrainView.js';
import { createTimeControl } from '../ui/timeControl.js';
import { createIntervalBars } from '../ui/intervalBars.js';
import { skyTrack, moonGeometry, intervals, siteParams, ENGINE_LABEL } from '../lunarData.js';

const SPEEDS = [
  { label: '1 h / s', hoursPerSecond: 1 },
  { label: '6 h / s', hoursPerSecond: 6 },
  { label: '1 day / s', hoursPerSecond: 24 },
  { label: '3 days / s', hoursPerSecond: 72 },
];

export async function mount(root, params = new URLSearchParams()) {
  // ---- scenario from the planner (or defaults) ----------------------------------------------------
  const engine = params.get('engine') === 'planner' ? 'planner' : 'horizons';
  const num = (k) => { const v = Number(params.get(k)); return params.has(k) && Number.isFinite(v) ? v : null; };
  const pDate = (k) => { const v = params.get(k); const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
  const lat = num('lat'), lon = num('lon');
  const match = lat != null && lon != null
    ? sites.list.find((s) => Math.abs(s.lat - lat) < 1e-4 && Math.abs((((s.lon - lon) % 360) + 540) % 360 - 180) < 1e-4) : null;
  if (match) setState({ site: match.id });    // planner coordinates equal a preset: use it (no duplicate pin)
  const custom = lat != null && lon != null && !match ? { id: 'custom', name: 'Planner site', lat, lon, preset: false } : null;
  const start = pDate('start') ?? DATA_START, end = pDate('end') ?? DATA_END;
  const fromPlanner = !!custom || !!match || params.has('start');

  const presetObj = (id) => ({ ...sites.byId[id], preset: true });
  let site = custom ?? presetObj(sites.byId[state.site] ? state.site : sites.list[0].id);
  const pinSites = [...sites.list, ...(custom ? [custom] : [])];

  // ---- layout -------------------------------------------------------------------------------------
  const stageBox = el('div', { class: 'stage' });
  const globeLayer = el('div', { class: 'layer' });
  const groundLayer = el('div', { class: 'layer off' });
  stageBox.append(globeLayer, groundLayer);

  const siteSel = el('select', { 'aria-label': 'Landing site' },
    ...(custom ? [el('option', { value: 'custom', selected: true }, `Planner site · ${fmtCoord(lat, lon)}`)] : []),
    ...sites.list.map((s) => el('option', { value: s.id, selected: !custom && s.id === site.id }, s.name)));
  const facts = el('dl', { class: 'facts' });
  const status = el('p', { class: 'small', 'aria-live': 'polite' });
  const toGround = el('button', { class: 'btn primary', type: 'button' }, 'Go to ground view');
  const toGlobe = el('button', { class: 'btn back', type: 'button', hidden: true }, '← Back to globe');
  stageBox.append(toGlobe);
  const bars = createIntervalBars({ title: 'Calculated timeline' });

  const t0 = Math.min(end, Math.max(start, fromPlanner ? start : (state.lunarTime ?? DEFAULT_TIME)));
  const ctl = createTimeControl({ start, end, time: t0, speeds: SPEEDS, speedIndex: 1, label: 'Scenario time (UTC)' });

  root.append(el('section', { class: 'page' },
    el('div', { class: 'analyze' }, stageBox,
      el('aside', {},
        el('div', {}, el('div', { class: 'eyebrow' }, fromPlanner ? 'Lunar surface · from the planner · UTC' : 'Lunar surface · single site · UTC'),
          el('h2', { style: 'margin-top:6px' }, 'Analyze one site'),
          el('p', { class: 'small muted', style: 'margin:4px 0 0' }, `${fmtUTC(start)} → ${fmtUTC(end)}`)),
        el('label', { class: 'field param' }, 'Landing site', siteSel),
        facts, status,
        el('div', {}, toGround),
        el('div', { class: 'divider' }),
        bars.node,
        el('div', { class: 'divider' }),
        el('p', { class: 'small muted' }, `Sun and Earth: ${ENGINE_LABEL[engine]}. Drag to rotate the Moon; click a pin to descend to the ground.`),
        el('p', { class: 'small muted' }, 'Ground view: LROC WAC heights around the site (~117 m spacing; coarse near the pole). Small craters below that resolution are illustrative.'))),
    ctl.node));

  const has3D = webglAvailable();
  if (!has3D) staticFallback(globeLayer, u('/assets/moon/albedo.jpg'), 'LROC WAC global mosaic');
  const loading = has3D ? loadingOverlay(globeLayer, 'Preparing the Moon…') : null;
  let mode = 'globe', ground = null, groundKey = null;

  const globe = has3D ? createMoonGlobe(globeLayer, {
    sites: pinSites, selected: site.id, interactive: true, autoRotate: false,
    onSelect: (id) => selectSite(id), onPinClick: (id) => { selectSite(id).then(descend); },
  }) : null;
  globe?.ready.then(() => loading.done()).catch(() => loading.error('Lunar textures could not load.'));

  // ---- data -----------------------------------------------------------------------------------------
  let geom = null, sky = null;
  try { geom = await moonGeometry(start, end, engine); } catch (e) { status.textContent = 'Sun geometry unavailable: ' + e.message; }

  async function loadSite() {
    sky = null;
    try { sky = await skyTrack(site, start, end, engine); } catch (e) { status.textContent = 'Sun/Earth data unavailable: ' + e.message; }
    intervals(site, start, end, engine, sky)
      .then((r) => { bars.set(r.rows, start, end, r.source); bars.cursor(ctl.time); })
      .catch((e) => bars.setError('Intervals unavailable: ' + e.message));
  }
  await loadSite();

  const skyAt = (t) => sky && ({
    sunAz: sampleSeries(sky.t, sky.sun_az, t, true), sunEl: sampleSeries(sky.t, sky.sun_el, t),
    earthAz: sampleSeries(sky.t, sky.earth_az, t, true), earthEl: sampleSeries(sky.t, sky.earth_el, t),
  });

  function renderFacts(t) {
    const k = skyAt(t);
    const rows = [['Site', site.name], ['Latitude', `${Math.abs(site.lat).toFixed(4)}° ${site.lat < 0 ? 'S' : 'N'}`],
      ['Longitude', `${(((site.lon % 360) + 360) % 360).toFixed(4)}° E`], ['From the pole', `${((90 - Math.abs(site.lat)) * 30.32).toFixed(0)} km`]];
    if (k) {
      rows.push(['Sun', `${k.sunEl.toFixed(2)}° · ${k.sunAz.toFixed(0)}° ${compassName(k.sunAz)}`]);
      rows.push(['Earth', `${k.earthEl.toFixed(2)}° · ${k.earthAz.toFixed(0)}° ${compassName(k.earthAz)}`]);
      rows.push(['Both above', k.sunEl > 0 && k.earthEl > 0 ? 'yes' : 'no']);
    }
    facts.replaceChildren(...rows.flatMap(([a, b]) => [el('dt', {}, a), el('dd', {}, b)]));
  }

  function applyTime(t) {
    if (geom && globe) {
      globe.setSun(sampleSeries(geom.t, geom.sub_solar_lon, t, true), sampleSeries(geom.t, geom.sub_solar_lat, t));
      globe.setEarth(sampleSeries(geom.t, geom.sub_earth_lon, t, true), sampleSeries(geom.t, geom.sub_earth_lat, t));
    }
    const k = skyAt(t);
    if (k && ground) ground.setSky(k);
    bars.cursor(t);
    renderFacts(t);
  }

  async function selectSite(id) {
    const next = id === 'custom' && custom ? custom : presetObj(id);
    if (next.id === site.id) return;
    site = next;
    if (site.preset) setState({ site: site.id });
    siteSel.value = site.id;
    globe?.setSelected(site.id);
    await loadSite();
    applyTime(ctl.time);
  }
  siteSel.addEventListener('change', () => selectSite(siteSel.value));

  function ensureGround() {
    const key = `${site.lat},${site.lon}`;
    if (ground && groundKey === key) return;
    ground?.dispose();
    groundLayer.replaceChildren();
    groundKey = key;
    const gl = loadingOverlay(groundLayer, 'Loading terrain…');
    const k = skyAt(ctl.time);
    ground = createTerrainView(groundLayer, { siteId: siteParams(site), headingDeg: k ? k.earthAz : 0,
      onError: () => gl.error('Terrain could not load (a new site needs internet once).') });
    ground.ready.then(() => gl.done()).catch(() => {});
    if (k) ground.setSky(k);
  }

  function descend() {
    if (!has3D || mode !== 'globe' || globe.flying) return;
    mode = 'flying';
    ensureGround();
    const k = skyAt(ctl.time);
    globe.flyToSite(site.id, {
      headingDeg: k ? k.earthAz : 0, duration: 2.8,
      onArrive: () => {
        groundLayer.classList.remove('off'); globeLayer.classList.add('off');
        toGlobe.hidden = false; toGround.disabled = true; mode = 'ground';
        toGlobe.focus();
      },
    });
  }
  function ascend() {
    if (mode !== 'ground') return;
    mode = 'flying';
    globeLayer.classList.remove('off'); groundLayer.classList.add('off');
    toGlobe.hidden = true;
    globe.flyBack({ duration: 2.2, onArrive: () => { mode = 'globe'; toGround.disabled = false; } });
  }
  toGround.addEventListener('click', descend);
  toGlobe.addEventListener('click', ascend);
  const esc = (e) => { if (e.key === 'Escape') ascend(); };
  window.addEventListener('keydown', esc);

  if (globe) {
    applyTime(ctl.time);
    // frame the selected site: south sites from below, north sites from above
    const camLat = Math.max(-72, Math.min(72, site.lat * 0.85));
    globe.frameSouthPole(3.0, camLat, site.lon, 0.3 * Math.sin(site.lat * Math.PI / 180));
  } else renderFacts(ctl.time);
  ctl.onTime((t, src) => { applyTime(t); if (src !== 'play' && !fromPlanner) setState({ lunarTime: t }); });

  let alive = true, last = performance.now();
  const loop = (now) => {
    if (!alive) return;
    ctl.tick(Math.min(0.1, (now - last) / 1000)); last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    unmount() {
      alive = false; if (!fromPlanner) setState({ lunarTime: ctl.time });
      window.removeEventListener('keydown', esc);
      ctl.dispose(); globe?.dispose(); ground?.dispose();
    },
  };
}
