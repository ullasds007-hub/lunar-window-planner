import { api, BASE } from './api.js';
import { state, sites, onState, setState } from './state.js';
import { fmtCoord, el } from './util.js';

const pages = {
  home: () => import('./pages/home.js'),
  compare: () => import('./pages/compare.js'),
  analyze: () => import('./pages/analyze.js'),
  observe: () => import('./pages/observe.js'),
};
const titles = { home: 'Home', compare: 'Compare landing sites', analyze: 'Analyze one site', observe: 'Observe from Earth' };

const main = document.getElementById('main');
export const EMBED = new URLSearchParams(location.search).get('embed') === '1';
if (EMBED) document.body.classList.add('embed');
let current = null;
let token = 0;

function renderActiveSite() {
  const box = document.getElementById('activeSite');
  const s = sites.byId[state.site];
  box.replaceChildren();
  if (!s) return;
  box.append(el('span', { class: 'dot', 'aria-hidden': 'true' }),
    el('span', {}, 'Selected: ', el('strong', {}, s.name)),
    el('span', { class: 'coord' }, fmtCoord(s.lat, s.lon)));
}

async function route() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const name = path || 'home';
  // shareable links: #/compare?t=2026-12-16T06:00Z&a=site04&b=site11 · #/analyze?site=site11 · #/observe?place=ksc_lc39a
  if (query) {
    const q = new URLSearchParams(query), patch = {};
    if (q.get('t') && !Number.isNaN(Date.parse(q.get('t')))) patch.lunarTime = Date.parse(q.get('t'));
    if (q.get('site') && sites.byId[q.get('site')]) patch.site = q.get('site');
    if (q.get('a') && sites.byId[q.get('a')]) patch.compareA = q.get('a');
    if (q.get('b') && sites.byId[q.get('b')]) patch.compareB = q.get('b');
    if (q.get('place')) patch.place = q.get('place');
    if (q.get('date')) patch.observeDate = q.get('date');
    if (Object.keys(patch).length) setState(patch);
  }
  const key = pages[name] ? name : 'home';
  document.querySelectorAll('nav a').forEach((a) => {
    if (a.dataset.route === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${titles[key]} · Lunar Window Planner`;
  const my = ++token;
  if (current?.unmount) { try { current.unmount(); } catch (e) { console.warn(e); } }
  current = null;
  main.replaceChildren();
  try {
    const mod = await pages[key]();
    if (my !== token) return;
    current = await mod.mount(main, new URLSearchParams(query || ''));
  } catch (e) {
    console.error(e);
    main.replaceChildren(el('div', { class: 'page', style: 'padding:40px' },
      el('h2', {}, 'This view could not load'), el('p', { class: 'muted' }, String(e.message || e))));
  }
  main.focus({ preventScroll: true });
}

async function boot() {
  try {
    sites.list = await api.lunarSites();
    sites.byId = Object.fromEntries(sites.list.map((s) => [s.id, s]));
  } catch (e) {
    console.warn('lunar sites unavailable', e);
  }
  renderActiveSite();
  if (BASE && !EMBED) {   // opened from the planner website in its own tab: offer a way back
    const ref = document.referrer && new URL(document.referrer).origin === location.origin ? document.referrer : '/';
    document.querySelector('.shell').insertBefore(
      el('a', { class: 'btn back-planner', href: ref, title: 'Back to the Lunar Window Planner' }, '\u2190 Planner'),
      document.querySelector('.shell nav'));
  }
  onState((s, patch) => { if ('site' in patch) renderActiveSite(); });
  window.addEventListener('hashchange', route);
  route();
}
boot();
