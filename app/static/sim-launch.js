/* 3D simulation, embedded in each planner page.
 *
 * The simulation (served at /sim/app/) is shown in panels inside this page, in "embed" mode: no parameter
 * controls of its own. Its inputs are this page's inputs:
 *   Compare landing sites -> two separate panels, Scenario A and Scenario B (updates on "Run comparison");
 *                            "Link the two clocks" keeps them at the same relative progress
 *   Analyze one site      -> latitude/longitude and UTC range (updates on "Show timeline")
 *   Observe from Earth    -> place, nights and goal            (updates on "Find windows" or a new place)
 *   Home                  -> globe with all landing sites
 * Sun/Earth geometry and windows come from this planner's engine (surface-sky, surface-geometry,
 * surface-windows, /windows). A small tab on the right edge jumps to the panels and shows them.
 */
(() => {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const route = path.startsWith('/lunar-surface/compare') ? 'compare'
    : path.startsWith('/lunar-surface') ? 'analyze'
    : path.startsWith('/earth') ? 'observe'
    : path === '/' ? 'home' : null;
  if (!route) return;

  const TITLES = {
    home: 'Lunar south-pole landing sites in 3D',
    analyze: 'This site on the Moon and at ground level',
    observe: 'The sky from this place',
  };
  const HEIGHTS = { home: 560, compare: 700, analyze: 720, observe: 640 };
  const UPDATE_ON = { compare: '#form', analyze: '#f', observe: '#planner' };

  // ---------- styles (planner palette) ----------
  const css = `
  .sim-panel{display:grid;gap:10px;background:var(--deep,#112f27);color:var(--white,#fffdf6);border-radius:14px;padding:14px;scroll-margin-top:16px}
  .sim-panel[hidden]{display:none}
  .sim-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .sim-head h2{font-size:1.15rem;margin:0;color:var(--white,#fffdf6)}
  .sim-head .sim-kicker{font-size:.72rem;letter-spacing:.085em;font-weight:800;text-transform:uppercase;color:var(--lime,#d8f196)}
  .sim-head .sim-note{font-size:.82rem;color:#c9d6cf}
  .sim-head button{min-height:36px;padding:6px 14px;border-radius:999px;border:1px solid rgba(216,241,150,.4);background:transparent;color:var(--lime,#d8f196);font:600 .85rem system-ui,sans-serif;cursor:pointer}
  .sim-head button:focus-visible,.sim-link input:focus-visible{outline:3px solid var(--lime,#d8f196);outline-offset:2px}
  .sim-frame{width:100%;border:0;border-radius:10px;background:#04060a;display:block}
  .sim-panel.sim-min .sim-frame,.sim-panel.sim-min .sim-note{display:none}
  .sim-panel.sim-max{position:fixed;inset:10px;z-index:1000;box-shadow:0 20px 60px rgba(0,0,0,.45);grid-template-rows:auto 1fr}
  .sim-panel.sim-max .sim-frame{height:100% !important;min-height:0}
  body.sim-has-max{overflow:hidden}
  .sim-head .sim-btns{display:flex;gap:6px;flex-wrap:wrap}
  .sim-head button[aria-pressed=true]{background:var(--lime,#d8f196);color:var(--deep,#112f27)}
  .sim-link{display:flex;align-items:center;gap:8px;font:600 .9rem system-ui,sans-serif;color:var(--ink,#152923)}
  .sim-link[hidden]{display:none}
  .sim-link input{width:18px;height:18px;accent-color:var(--accent,#145343)}
  .sim-launch{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:50;display:flex;align-items:center;gap:8px;writing-mode:vertical-rl;
    padding:14px 9px;border-radius:10px 0 0 10px;background:var(--deep,#112f27);color:var(--lime,#d8f196);font:600 13px/1 system-ui,sans-serif;letter-spacing:.04em;
    box-shadow:0 4px 18px rgba(0,0,0,.18);border:1px solid rgba(216,241,150,.35);border-right:0;cursor:pointer;transition:padding .2s ease}
  .sim-launch:hover{padding-right:13px}.sim-launch:focus-visible{outline:3px solid var(--lime,#d8f196);outline-offset:2px}
  .sim-launch svg{writing-mode:horizontal-tb;flex:none}
  @media (max-width:640px){.sim-launch{top:auto;bottom:16px;transform:none;writing-mode:horizontal-tb;padding:10px 12px}}
  @media (prefers-reduced-motion:reduce){.sim-launch{transition:none}}`;
  document.head.append(Object.assign(document.createElement('style'), { textContent: css }));

  // ---------- read this page's parameters ----------
  const val = (root, sel) => root.querySelector(sel)?.value ?? '';
  const utcLocal = (d) => (!d ? '' : d.length === 10 ? `${d}T00:00:00Z` : `${d.length === 16 ? d + ':00' : d}Z`);
  const scenario = (i) => document.querySelectorAll('#inputs fieldset')[i];
  function query() {
    const q = new URLSearchParams({ engine: 'planner' });
    if (route === 'compare') {
      const A = scenario(0), B = scenario(1);
      if (A && B) {
        q.set('a', `${val(A, '[name=lat]')},${val(A, '[name=lon]')}`);
        q.set('b', `${val(B, '[name=lat]')},${val(B, '[name=lon]')}`);
        q.set('startA', utcLocal(val(A, '[name=start]'))); q.set('endA', utcLocal(val(A, '[name=end]')));
        q.set('startB', utcLocal(val(B, '[name=start]'))); q.set('endB', utcLocal(val(B, '[name=end]')));
      }
    } else if (route === 'analyze') {
      const f = document.getElementById('f');
      if (f) {
        q.set('lat', val(f, '[name=lat]')); q.set('lon', val(f, '[name=lon]'));
        q.set('start', utcLocal(val(f, '[name=start]'))); q.set('end', utcLocal(val(f, '[name=end]')));
      }
    } else if (route === 'observe') {
      const pl = window.lwpPlace ? window.lwpPlace() : null;
      if (pl && val(document, '[name="locationId"]') === 'custom') {
        q.set('place', 'custom'); q.set('lat', pl.lat); q.set('lon', pl.lon); q.set('tz', pl.tz); q.set('name', pl.name);
      } else q.set('place', 'mysuru');
      const d = val(document, 'input[name="startDate"]'), e = val(document, 'input[name="endDate"]');
      if (d) q.set('date', d);
      if (e) q.set('end', e);
      const g = val(document, 'select[name="goal"]');
      if (g) q.set('goal', g);
    }
    return q;
  }
  const scenarioTitle = (i) => {
    const f = scenario(i);
    if (!f) return `Scenario ${'AB'[i]}`;
    const sel = f.querySelector('select');
    const preset = sel && sel.value ? sel.selectedOptions[0].textContent.replace(/ — .*$/, '') : null;
    const where = preset || `${val(f, '[name=lat]')}°, ${val(f, '[name=lon]')}° E`;
    return `Scenario ${'AB'[i]} · ${where} · ${val(f, '[name=start]')} → ${val(f, '[name=end]')}`;
  };

  // ---------- panels ----------
  const main = document.querySelector('main');
  const anchor = main.querySelector('aside.model');
  const panels = [];
  function makePanel({ id, kicker, title, extra }) {
    const panel = document.createElement('section');
    panel.className = 'sim-panel';
    panel.id = id;
    panel.hidden = true;
    panel.setAttribute('aria-label', `${kicker}: ${title}`);
    panel.innerHTML = `
      <div class="sim-head">
        <div><div class="sim-kicker"></div><h2></h2>
          <div class="sim-note">Uses the inputs above. Drag to look around; use the timeline to play.</div></div>
        <div class="sim-btns">
          <button type="button" class="sim-min-btn" aria-pressed="false" title="Minimize this panel to its title bar">– Min</button>
          <button type="button" class="sim-max-btn" aria-pressed="false" title="Maximize this panel to the window (Esc to restore)">□ Max</button>
          <button type="button" class="sim-full" title="Browser full screen">Full screen</button>
          <button type="button" class="sim-hide" title="Hide this panel (the side tab brings it back)">Hide</button>
        </div>
      </div>
      <iframe class="sim-frame" title="${kicker}" loading="lazy" allow="fullscreen"></iframe>`;
    panel.querySelector('.sim-kicker').textContent = kicker;
    panel.querySelector('h2').textContent = title;
    const frame = panel.querySelector('iframe');
    frame.style.height = `${HEIGHTS[route]}px`;
    anchor ? main.insertBefore(panel, anchor) : main.append(panel);
    const p = { panel, frame, extra, shown: null, id, mode: 'normal' };
    panel.querySelector('.sim-hide').addEventListener('click', () => { setMode(p, 'normal'); panel.hidden = true; frame.removeAttribute('src'); p.shown = null; clockVisibilityChanged(); if (linkRow && panels.every(o => o.panel.hidden)) linkRow.hidden = true; tab.focus(); });
    panel.querySelector('.sim-min-btn').addEventListener('click', () => setMode(p, p.mode === 'min' ? 'normal' : 'min'));
    panel.querySelector('.sim-max-btn').addEventListener('click', () => setMode(p, p.mode === 'max' ? 'normal' : 'max'));
    panel.querySelector('.sim-full').addEventListener('click', () => frame.requestFullscreen?.());
    panels.push(p);
    return p;
  }
  function setMode(p, mode) {
    if (mode === 'max') panels.forEach((o) => { if (o !== p && o.mode === 'max') setMode(o, 'normal'); });
    p.mode = mode;
    p.panel.classList.toggle('sim-min', mode === 'min');
    p.panel.classList.toggle('sim-max', mode === 'max');
    const minB = p.panel.querySelector('.sim-min-btn'), maxB = p.panel.querySelector('.sim-max-btn');
    minB.setAttribute('aria-pressed', String(mode === 'min')); minB.textContent = mode === 'min' ? '▢ Restore' : '– Min';
    maxB.setAttribute('aria-pressed', String(mode === 'max')); maxB.textContent = mode === 'max' ? '❐ Restore' : '□ Max';
    document.body.classList.toggle('sim-has-max', panels.some((o) => o.mode === 'max'));
    if (mode === 'max') maxB.focus();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') panels.forEach((o) => { if (o.mode === 'max') setMode(o, 'normal'); });
  });

  function refresh(p) {
    if (p.panel.hidden) return;
    const q = query();
    for (const [k, v] of Object.entries(p.extra || {})) q.set(k, v);
    const h = `#/${route}?${q}`;
    if (h === p.shown) return;
    p.shown = h;
    try {
      if (p.frame.contentWindow && p.frame.contentWindow.location.pathname.startsWith('/sim/app')) {
        p.frame.contentWindow.location.hash = h;   // same app, new inputs: no reload
        return;
      }
    } catch { /* not loaded yet */ }
    p.frame.src = `/sim/app/?embed=1${h}`;
  }
  const refreshAll = () => {
    if (route === 'compare') panels.forEach((p, i) => { p.panel.querySelector('h2').textContent = scenarioTitle(i); });
    panels.forEach(refresh);
  };

  let link = null, linkRow = null;
  let clockVisibilityChanged = () => {};
  if (route === 'compare') {
    // two separate spaces, one per scenario
    const pa = makePanel({ id: 'simulation', kicker: '3D simulation · Scenario A', title: scenarioTitle(0), extra: { only: 'A' } });
    linkRow = document.createElement('label');
    linkRow.hidden = true;
    linkRow.className = 'sim-link';
    linkRow.innerHTML = '<input type="checkbox" checked> Link the two clocks (same relative progress through each date range)';
    main.insertBefore(linkRow, anchor || null);
    link = linkRow.querySelector('input');
    const pb = makePanel({ id: 'simulation-b', kicker: '3D simulation · Scenario B', title: scenarioTitle(1), extra: { only: 'B' } });
    // Arbitrate between the two same-origin frames. Ticks cannot take
    // ownership, so an in-flight tick cannot undo a Pause from the other panel.
    let leader = pa;
    const send = (panel, message) => panel.frame.contentWindow?.postMessage(message, location.origin);
    const request = (panel) => send(panel, { type: 'lwp:clock-request' });
    const detach = (panel) => send(panel, { type: 'lwp:clock-detach' });
    const bothVisible = () => !pa.panel.hidden && !pb.panel.hidden;
    clockVisibilityChanged = () => {
      leader = pa.panel.hidden ? pb : pa;
      for (const panel of [pa, pb]) if (!panel.panel.hidden) detach(panel);
    };
    link.addEventListener('change', () => {
      if (!link.checked) { detach(pa); detach(pb); }
      else if (bothVisible()) request(leader);
    });
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.data?.type !== 'lwp:clock' || !link.checked || !bothVisible()) return;
      const { from, kind, p, playing, speed } = e.data;
      const sender = from === 'A' ? pa : from === 'B' ? pb : null;
      if (!sender || e.source !== sender.frame.contentWindow) return;
      if (kind === 'ready') { request(leader); return; }
      if (!Number.isFinite(p) || typeof playing !== 'boolean') return;
      if (kind === 'action') {
        leader = sender;
        send(leader, { type: 'lwp:clock-lead', p, playing, speed });
      }
      else if (kind !== 'tick' || sender !== leader) return;
      send(sender === pa ? pb : pa, { type: 'lwp:clock-follow', p, playing, speed });
    });
  } else {
    makePanel({ id: 'simulation', kicker: '3D simulation', title: TITLES[route], extra: {} });
  }
  refreshAll();

  // update when the page's inputs are (re)applied
  const form = UPDATE_ON[route] && document.querySelector(UPDATE_ON[route]);
  if (form) {
    form.addEventListener('submit', () => setTimeout(refreshAll, 0));
    form.addEventListener('lwp:place', () => setTimeout(refreshAll, 0));
    if (route === 'compare') {
      document.getElementById('apply-delay')?.addEventListener('click', () => setTimeout(refreshAll, 0));
    }
  }

  // ---------- side tab ----------
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'sim-launch';
  tab.setAttribute('aria-controls', panels.map((p) => p.id).join(' '));
  tab.title = 'Show the 3D simulation on this page';
  tab.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" opacity=".55"/><ellipse cx="12" cy="12" rx="9" ry="3.4" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".7"/></svg><span>3D simulation</span>';
  tab.addEventListener('click', () => {
    if (linkRow) linkRow.hidden = false;
    panels.forEach((p) => { p.panel.hidden = false; if (p.mode === 'min') setMode(p, 'normal'); });
    refreshAll();
    panels[0].panel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });
  document.body.append(tab);
})();
