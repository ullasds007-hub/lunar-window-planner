(() => {
  const form = document.getElementById('planner');
  if (!form) return;
  const locationId = form.querySelector('[name="locationId"]');   // hidden: 'mysuru' or 'custom'
  const PHOTON = 'https://photon.komoot.io';
  const MYSURU = { name: 'Mysuru', lat: 12.2958, lon: 76.6394, tz: 'Asia/Kolkata' };

  // ---------- styles (uses the planner's palette variables) ----------
  const css = `
  .loc{display:grid;gap:8px;margin:4px 0 14px}
  .loc-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .loc-search{position:relative;flex:1 1 360px}
  .loc-input{width:100%;min-height:44px;padding:10px 14px 10px 38px;border-radius:999px;border:1px solid var(--edge,#cdd5c9);
    background:var(--surface,#fffdf6) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%234d6058' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E") no-repeat 14px 50%;
    font:inherit;color:var(--ink,#152923)}
  .loc-input:focus-visible{outline:3px solid var(--accent,#145343);outline-offset:1px}
  .loc-list{position:absolute;z-index:40;left:0;right:0;top:calc(100% + 6px);margin:0;padding:6px;list-style:none;max-height:320px;overflow:auto;
    background:var(--surface,#fffdf6);border:1px solid var(--edge,#cdd5c9);border-radius:12px;box-shadow:0 12px 28px rgba(17,47,39,.18)}
  .loc-list li{display:grid;gap:1px;padding:8px 10px;border-radius:8px;cursor:pointer}
  .loc-list li .n{font-weight:600}.loc-list li .d{font-size:.82rem;color:var(--muted,#4d6058)}
  .loc-list li.on,.loc-list li:hover{background:var(--soft,#dcebdf)}
  .loc-btn{min-height:44px;padding:8px 14px;border-radius:999px;border:1px solid var(--edge,#cdd5c9);background:var(--surface,#fffdf6);
    color:var(--accent,#145343);font:600 .9rem system-ui,sans-serif;cursor:pointer}
  .loc-btn:hover{background:var(--soft,#dcebdf)}.loc-btn:focus-visible{outline:3px solid var(--accent,#145343);outline-offset:2px}
  .loc-status{font-size:.86rem;color:var(--muted,#4d6058);min-height:1.2em}
  .loc-map{height:300px;border-radius:12px;overflow:hidden;border:1px solid var(--edge,#cdd5c9)}
  .loc-credit{font-size:.75rem;color:var(--muted,#4d6058)}`;
  document.head.append(Object.assign(document.createElement('style'), { textContent: css }));

  // ---------- markup ----------
  const wrap = document.createElement('div');
  wrap.className = 'loc';
  wrap.innerHTML = `
    <label for="loc-q" style="font-weight:600">Location · search a place or pick it on the map</label>
    <div class="loc-row">
      <div class="loc-search">
        <input id="loc-q" class="loc-input" type="search" autocomplete="off" role="combobox" aria-expanded="false"
          aria-controls="loc-list" aria-autocomplete="list" placeholder="Search for a city or place">
        <ul id="loc-list" class="loc-list" role="listbox" hidden></ul>
      </div>
      <button type="button" class="loc-btn" id="loc-map-btn" aria-expanded="false">Map</button>
      <button type="button" class="loc-btn" id="loc-device" aria-describedby="loc-privacy">Use my location</button>
    </div>
    <p class="loc-credit" id="loc-privacy">Optional: your browser asks if it needs permission. The planner sends your coordinates to its server for time zone lookup and calculations. Search or use the map to choose another place.</p>
    <div class="loc-status" id="loc-status" aria-live="polite"></div>
    <div class="loc-map" id="loc-map" hidden></div>
    <div class="loc-credit" id="loc-credit"></div>`;
  form.querySelector('.form-grid').after(wrap);
  const hidden = Object.fromEntries(['lat', 'lon', 'tz', 'name'].map((n) => {
    const i = Object.assign(document.createElement('input'), { type: 'hidden', name: n, disabled: true });
    form.append(i); return [n, i];
  }));
  const input = wrap.querySelector('#loc-q'), list = wrap.querySelector('#loc-list'), status = wrap.querySelector('#loc-status');
  const mapBox = wrap.querySelector('#loc-map'), mapBtn = wrap.querySelector('#loc-map-btn'), credit = wrap.querySelector('#loc-credit');
  const eyebrow = document.querySelector('main > .eyebrow'), lede = document.querySelector('main > .lede');

  // ---------- provider config ----------
  credit.textContent = 'Search terms go to Photon (OpenStreetMap data). Map tiles: © OpenStreetMap contributors.';
  const loadScript = (src) => new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    document.head.append(Object.assign(document.createElement('script'), { src, async: true, onload: res, onerror: rej }));
  });
  // ---------- current place ----------
  let current = MYSURU;
  const tzAbbr = (tz) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName').value; } catch { return tz; } };
  function applyPlace(p) {
    current = p;
    const custom = p !== MYSURU;
    locationId.value = custom ? 'custom' : 'mysuru';
    input.value = custom ? p.name : '';   // default place: empty box with the hint
    if (custom) {
      Object.assign(hidden.lat, { value: p.lat, disabled: false }); Object.assign(hidden.lon, { value: p.lon, disabled: false });
      Object.assign(hidden.tz, { value: p.tz, disabled: false }); Object.assign(hidden.name, { value: p.name, disabled: false });
    } else {
      Object.values(hidden).forEach((i) => { i.disabled = true; });
    }
    if (eyebrow) eyebrow.textContent = `Earth observation / ${p.name} / ${tzAbbr(p.tz)}`;
    if (lede) lede.textContent = `Find Moon-viewing or dark-sky windows. Times are local to ${p.name} (${p.tz}); weather is not included.`;
    setMarker();
    form.dispatchEvent(new Event('lwp:place'));
  }
  window.lwpPlace = () => current;
  const deviceBtn = wrap.querySelector('#loc-device');
  let placeVersion = 0;

  async function pick(r, source, version = ++placeVersion) {
    if (version !== placeVersion) return;
    clearTimeout(timer);
    ++seq; // ignore any city search still in flight
    results = [];
    close();
    status.textContent = 'Finding the local time zone…';
    let tz = 'UTC', usedFallback = true;
    try {
      const params = new URLSearchParams({ lat: r.lat, lon: r.lon });
      const response = await fetch('/sim/geo/timezone?' + params, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Time zone lookup failed');
      const data = await response.json();
      if (typeof data.timezone === 'string' && data.timezone) {
        new Intl.DateTimeFormat('en', { timeZone: data.timezone });
        tz = data.timezone;
        usedFallback = false;
      }
    } catch { /* keep UTC and explain the fallback */ }
    if (version !== placeVersion) return;
    applyPlace({ name: r.name, lat: r.lat, lon: r.lon, tz, source });
    const coords = source === 'device' ? '' : ` · ${r.lat.toFixed(4)}°, ${r.lon.toFixed(4)}°`;
    status.textContent = `${r.name}${r.detail ? ' · ' + r.detail : ''}${coords} · ${usedFallback ? 'Time zone unavailable; using UTC' : tz}. Select Find windows.`;
  }

  deviceBtn.addEventListener('click', () => {
    if (!window.isSecureContext || !navigator.geolocation) {
      status.textContent = 'Device location is unavailable here. Use HTTPS or the localhost preview, or choose a place with search or the map.';
      return;
    }
    const version = ++placeVersion;
    clearTimeout(timer);
    ++seq;
    results = [];
    close();
    deviceBtn.disabled = true;
    status.textContent = 'Getting your device location…';
    const fail = (err) => {
      deviceBtn.disabled = false;
      if (version !== placeVersion) return;
      const reason = err.code === 1 ? 'Location permission was denied.' :
        err.code === 3 ? 'The location request timed out.' : 'Your device could not determine its location.';
      status.textContent = reason + ' Your current selection is unchanged. You can search or use the map instead.';
    };
    try {
      navigator.geolocation.getCurrentPosition(async ({ coords }) => {
        try {
          const { latitude: lat, longitude: lon } = coords;
          if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            fail({ code: 2 });
            return;
          }
          await pick({ name: 'My location', lat, lon }, 'device', version);
        } finally {
          deviceBtn.disabled = false;
        }
      }, fail, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
    } catch {
      fail({ code: 2 });
    }
  });

  // ---------- search ----------
  const tidy = (q) => q.replace(/^\s*(location|place|from|at)\s*[:\-]\s*/i, '').trim();
  async function searchPhoton(q) {
    const prm = new URLSearchParams({ q: tidy(q), limit: '6', lang: 'en' });
    const r = await fetch(`${PHOTON}/api/?${prm}`);
    if (!r.ok) throw new Error(`search failed (${r.status})`);
    return (await r.json()).features.map((f) => {
      const p = f.properties, area = [p.district || p.locality, p.city || p.county, p.state, p.country].filter(Boolean);
      return { name: p.name || area[0] || 'Unnamed place', detail: [...new Set(area)].join(', '), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
    });
  }
  let results = [], active = -1, timer = null, seq = 0;
  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; input.removeAttribute('aria-activedescendant'); }
  function render() {
    list.replaceChildren(...results.map((r, i) => {
      const li = document.createElement('li');
      li.id = `loc-opt-${i}`; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === active));
      if (i === active) li.className = 'on';
      li.innerHTML = '<span class="n"></span><span class="d"></span>';
      li.querySelector('.n').textContent = r.name; li.querySelector('.d').textContent = r.detail;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(r, 'search'); });
      return li;
    }));
    list.hidden = !results.length;
    input.setAttribute('aria-expanded', String(!!results.length));
    if (active >= 0) input.setAttribute('aria-activedescendant', `loc-opt-${active}`);
  }
  async function run(q) {
    const my = ++seq; status.textContent = 'Searching…';
    try {
      const out = await searchPhoton(q);
      if (my !== seq) return;
      results = out; active = out.length ? 0 : -1; render();
      status.textContent = out.length ? `${out.length} result${out.length > 1 ? 's' : ''} · Enter picks the highlighted one` : 'No place found. Try adding the city or area.';
    } catch (e) { if (my === seq) status.textContent = 'Search unavailable: ' + e.message; }
  }
  input.addEventListener('input', () => {
    ++placeVersion;
    ++seq;
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { results = []; close(); return; }
    timer = setTimeout(() => run(q), 380);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && results.length) { active = (active + 1) % results.length; render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && results.length) { active = (active - 1 + results.length) % results.length; render(); e.preventDefault(); }
    else if (e.key === 'Enter') {
      e.preventDefault();                       // never submit the form from the search box
      if (results[active]) pick(results[active], 'search');
      else if (input.value.trim().length >= 3) { clearTimeout(timer); run(input.value.trim()).then(() => results[0] && pick(results[0], 'search')); }
    } else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));

  // ---------- map ----------
  let map = null, marker = null;
  function setMarker() {
    if (!map) return;
    if (current.source === 'device') { if (marker) { marker.remove(); marker = null; } return; }
    const { lat, lon } = current;
    marker ? marker.setLatLng([lat, lon]) : (marker = L.circleMarker([lat, lon], { radius: 8, color: '#145343', weight: 3, fillColor: '#d8f196', fillOpacity: 1 }).addTo(map.m)); map.m.panTo([lat, lon]);
  }
  async function openMap() {
    mapBox.hidden = false; mapBtn.setAttribute('aria-expanded', 'true');
    if (map) { if (map.kind === 'leaflet') map.m.invalidateSize(); return; }
    try {
        if (!document.querySelector('link[data-leaflet]')) {
          const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css' });
          link.setAttribute('data-leaflet', '1');
          document.head.append(link);
        }
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js');
        const center = current.source === 'device' ? MYSURU : current;
        const m = L.map(mapBox).setView([center.lat, center.lon], 11);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m);
        map = { kind: 'leaflet', m };
        m.on('click', async (e) => pick({ name: 'Picked on map', detail: '', lat: e.latlng.lat, lon: e.latlng.lng }, 'map'));
      setMarker();
      status.textContent = 'Click the map to observe from that spot.';
    } catch (e) { status.textContent = 'Map could not load: ' + (e.message || e); }
  }
  mapBtn.addEventListener('click', () => { if (mapBox.hidden) openMap(); else { mapBox.hidden = true; mapBtn.setAttribute('aria-expanded', 'false'); } });

  applyPlace(MYSURU);
  status.textContent = 'Default location: Mysuru. Choose a different location or select Find windows.';
})();
