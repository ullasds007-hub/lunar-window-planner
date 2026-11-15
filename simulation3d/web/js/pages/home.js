import { u } from '../api.js';
import { moonGeometry } from '../lunarData.js';
import { state, sites, setState, DEFAULT_TIME, prefersReducedMotion } from '../state.js';
import { el, fmtCoord, fmtUTC } from '../util.js';
import { webglAvailable, loadingOverlay, staticFallback } from '../scene/common.js';
import { createMoonGlobe } from '../scene/moonGlobe.js';

export async function mount(root) {
  const stageBox = el('div', { class: 'stage' });
  // Landing sites live in a dropdown: the closed button shows the selected site
  const cards = el('div', { class: 'site-list', id: 'site-menu', role: 'group', 'aria-label': 'Landing sites', hidden: '' });
  const toggle = el('button', { class: 'site-card site-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'site-menu' });
  const drop = el('div', { class: 'site-drop' }, el('div', { class: 'site-drop-label' }, 'Landing site'), toggle, cards);
  const setOpen = (open) => {
    cards.hidden = !open;
    // open upward when there is not enough room below (e.g. inside the planner's embedded panel)
    if (open) {
      const t = toggle.getBoundingClientRect();
      const below = innerHeight - t.bottom, up = below < 260 && t.top > below;
      drop.classList.toggle('up', up);
      cards.style.maxHeight = `${Math.max(160, Math.min(380, (up ? t.top : below) - 16))}px`;
    }
    toggle.setAttribute('aria-expanded', String(open));
    drop.classList.toggle('open', open);
  };
  toggle.addEventListener('click', () => setOpen(cards.hidden));
  const onDocClick = (e) => { if (!drop.contains(e.target)) setOpen(false); };
  const onKey = (e) => { if (e.key === 'Escape' && !cards.hidden) { setOpen(false); toggle.focus(); } };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
  const analyzeLink = el('a', { class: 'btn primary', href: '#/analyze' }, 'Analyze selected site →');

  const page = el('section', { class: 'page home' },
    el('div', { class: 'intro' },
      el('div', { class: 'eyebrow' }, 'Lunar south pole · candidate landing sites'),
      el('h1', {}, 'Plan for sunlight. Plan for Earth in view.'),
      el('p', { class: 'lead' }, 'Near the south pole the Sun and Earth skim the horizon. A few days, or a few kilometres, can decide whether a lander has light and a line of sight home.'),
      drop,
      el('div', {}, analyzeLink),
      el('div', { class: 'links' },
        el('a', { href: '#/compare' }, el('span', { class: 't' }, 'Compare landing sites'), el('span', { class: 'd' }, 'Two ground views, one clock')),
        el('a', { href: '#/analyze' }, el('span', { class: 't' }, 'Analyze one site'), el('span', { class: 'd' }, 'Globe to ground')),
        el('a', { href: '#/observe' }, el('span', { class: 't' }, 'Observe from Earth'), el('span', { class: 'd' }, 'Moon phase and path')))),
    stageBox);
  root.append(page);

  const HISTORICAL = new Set(['im1', 'im2']);
  const card = (s) => el('button', {
    class: 'site-card', type: 'button', 'aria-pressed': String(s.id === state.site),
    onclick: () => { select(s.id); setOpen(false); toggle.focus(); },
  }, el('span', { class: 'site-dot' }), el('span', { class: 'name' }, s.name), el('span', { class: 'c' }, fmtCoord(s.lat, s.lon)));
  const renderCards = () => {
    const rec = sites.list.filter((s) => !HISTORICAL.has(s.id));
    const hist = sites.list.filter((s) => HISTORICAL.has(s.id));
    cards.replaceChildren(
      el('div', { class: 'site-group' }, `Top recommended · NASA south-pole sites (${rec.length})`), ...rec.map(card),
      ...(hist.length ? [el('div', { class: 'site-group' }, 'Historical landings'), ...hist.map(card)] : []));
    const cur = sites.byId[state.site] || sites.list[0];
    toggle.replaceChildren(el('span', { class: 'site-dot' }), el('span', { class: 'name' }, cur.name),
      el('span', { class: 'c' }, fmtCoord(cur.lat, cur.lon)), el('span', { class: 'chev', 'aria-hidden': 'true' }, '▾'));
    toggle.setAttribute('aria-label', `Landing site: ${cur.name}. Show all ${sites.list.length} sites`);
  };

  let globe = null;
  const select = (id) => { setState({ site: id }); renderCards(); globe?.setSelected(id); };
  renderCards();

  if (!webglAvailable()) {
    staticFallback(stageBox, u('/assets/moon/albedo.jpg'), 'LROC WAC global mosaic');
    return { unmount() { document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey); } };
  }

  const loading = loadingOverlay(stageBox, 'Preparing the Moon…');
  globe = createMoonGlobe(stageBox, {
    sites: sites.list, selected: state.site, onSelect: select,
    autoRotate: !prefersReducedMotion(), interactive: true,
  });
  const caption = el('div', { class: 'scene-caption' },
    el('div', {}, 'Sunlight and Earth direction for ', el('span', { class: 'mono' }, fmtUTC(DEFAULT_TIME))),
    el('div', { class: 'surface-src' }, 'Planner geometry'));
  const pauseBtn = el('button', { class: 'btn', type: 'button', 'aria-pressed': String(!prefersReducedMotion()) },
    prefersReducedMotion() ? 'Rotate' : 'Pause rotation');
  pauseBtn.addEventListener('click', () => {
    const on = pauseBtn.getAttribute('aria-pressed') !== 'true';
    globe.setAutoRotate(on);
    pauseBtn.setAttribute('aria-pressed', String(on));
    pauseBtn.textContent = on ? 'Pause rotation' : 'Rotate';
  });
  const resetBtn = el('button', { class: 'btn', type: 'button' }, 'Reset view');
  resetBtn.addEventListener('click', () => globe.frameSouthPole());
  stageBox.append(caption, el('div', { class: 'scene-tools' }, pauseBtn, resetBtn));

  try {
    const g = await moonGeometry(DEFAULT_TIME, DEFAULT_TIME + 3600e3, 'planner');
    globe.setSun(g.sub_solar_lon[0], g.sub_solar_lat[0]);
    globe.setEarth(g.sub_earth_lon[0], g.sub_earth_lat[0]);
  } catch (e) {
    caption.firstChild.textContent = 'Live Sun geometry unavailable; showing a typical lighting direction.';
  }
  globe.frameSouthPole();
  globe.ready.then(() => {
    loading.done();
    caption.querySelector('.surface-src').textContent = globe.assetMode === 'lroc'
      ? `Planner geometry · LROC WAC surface · relief ×${globe.reliefExaggeration}`
      : 'Planner geometry · simplified Moon surface';
  }).catch(() => loading.error('Lunar textures could not load.'));

  return { unmount() { globe.dispose(); document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey); } };
}
