// Location picker for "Observe from Earth": search like a map app, use the device location, or click a map.
//
// Provider (from the server's /geo/config):
//   google : Google Maps JavaScript API + Places text search (needs GOOGLE_MAPS_API_KEY on the server)
//   osm    : Photon search (OpenStreetMap data, photon.komoot.io) + OpenStreetMap tiles, no key needed
// Only the typed search text and chosen coordinates are sent to the provider.
import { el } from '../util.js';
import { u } from '../api.js';

const PHOTON = 'https://photon.komoot.io';
let configP = null;
const config = () => (configP ??= fetch(u('/geo/config')).then((r) => r.json()).catch(() => ({ provider: 'osm' })));

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script'); s.src = src; s.async = true; s.onload = res; s.onerror = rej;
    document.head.append(s);
  });
}
function loadCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  document.head.append(el('link', { rel: 'stylesheet', href }));
}
let googleP = null;
const loadGoogle = (key) => (googleP ??= loadScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&v=weekly`));
const loadLeaflet = () => {
  loadCss('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css');
  return loadScript('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js');
};

// --- search providers --------------------------------------------------------------------------------
const tidy = (q) => q.replace(/^\s*(location|place|from|at)\s*[:\-]\s*/i, '').trim();

async function searchPhoton(q, bias) {
  const params = new URLSearchParams({ q: tidy(q), limit: '6', lang: 'en' });
  if (bias) { params.set('lat', bias.lat); params.set('lon', bias.lon); }
  const r = await fetch(`${PHOTON}/api/?${params}`);
  if (!r.ok) throw new Error(`search failed (${r.status})`);
  const j = await r.json();
  return j.features.map((f) => {
    const p = f.properties;
    const area = [p.district || p.locality, p.city || p.county, p.state, p.country].filter(Boolean);
    return { name: p.name || area[0] || 'Unnamed place', detail: [...new Set(area)].join(', '), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
  });
}
async function reversePhoton(lat, lon) {
  try {
    const r = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lon}&lang=en`);
    const p = (await r.json()).features?.[0]?.properties;
    if (!p) return null;
    return [p.name, p.district || p.locality, p.city].filter(Boolean).slice(0, 2).join(', ');
  } catch { return null; }
}
function searchGoogle(q, bias) {
  return new Promise((res, rej) => {
    const svc = new google.maps.places.PlacesService(document.createElement('div'));
    const req = { query: tidy(q) };
    if (bias) { req.location = new google.maps.LatLng(bias.lat, bias.lon); req.radius = 50000; }
    svc.textSearch(req, (results, status) => {
      if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) { res([]); return; }
      if (status !== google.maps.places.PlacesServiceStatus.OK) { rej(new Error(`Google Places: ${status}`)); return; }
      res(results.slice(0, 6).map((p) => ({ name: p.name, detail: p.formatted_address || '', lat: p.geometry.location.lat(), lon: p.geometry.location.lng() })));
    });
  });
}

/**
 * opts: { place: {latitude_deg, longitude_deg, name}, onPick(place) }
 * onPick receives { id:'custom', name, latitude_deg, longitude_deg, timezone, elevation_m:0, source }
 */
export function createLocationPicker({ place, onPick }) {
  const input = el('input', { type: 'search', class: 'loc-input', placeholder: 'Search a place, e.g. Rameshwaram Cafe JP Nagar Bengaluru',
    role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'loc-list', 'aria-autocomplete': 'list', 'aria-label': 'Search a location', autocomplete: 'off' });
  const list = el('ul', { id: 'loc-list', class: 'loc-list', role: 'listbox', hidden: true });
  const meBtn = el('button', { class: 'btn', type: 'button', title: 'Use this device’s location (your browser will ask for permission)' },
    el('span', { 'aria-hidden': 'true' }, '◎'), 'My location');
  const mapBtn = el('button', { class: 'btn', type: 'button', 'aria-expanded': 'false' }, 'Map');
  const status = el('div', { class: 'loc-status small muted', 'aria-live': 'polite' });
  const mapBox = el('div', { class: 'loc-map', hidden: true });
  const credit = el('div', { class: 'loc-credit small muted' });
  const node = el('div', { class: 'loc' },
    el('div', { class: 'loc-row' }, el('div', { class: 'loc-search' }, input, list), meBtn, mapBtn),
    status, mapBox, credit);

  let current = place, results = [], active = -1, timer = null, seq = 0, map = null, marker = null, cfg = null;
  config().then((c) => {
    cfg = c;
    credit.textContent = c.provider === 'google' ? 'Search and map: Google Maps' : 'Search: Photon (OpenStreetMap data) · Map: © OpenStreetMap contributors';
  });

  async function pick(r, source) {
    status.textContent = 'Finding the local time zone…';
    let tz = 'UTC';
    try { tz = (await (await fetch(u('/geo/timezone?') + new URLSearchParams({ lat: r.lat, lon: ((r.lon + 540) % 360) - 180 }))).json()).timezone; } catch { /* keep UTC */ }
    current = { id: 'custom', name: r.name, detail: r.detail || '', latitude_deg: r.lat, longitude_deg: r.lon, timezone: tz, elevation_m: 0, source };
    status.textContent = `${r.name}${r.detail ? ' · ' + r.detail : ''} · ${r.lat.toFixed(4)}°, ${r.lon.toFixed(4)}° · ${tz}`;
    closeList();
    input.value = r.name;
    setMarker(r.lat, r.lon);
    onPick?.(current);
  }

  // --- suggestions -----------------------------------------------------------------------------------
  function closeList() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; }
  function renderList() {
    list.replaceChildren(...results.map((r, i) => {
      const li = el('li', { id: `loc-opt-${i}`, role: 'option', 'aria-selected': String(i === active), class: i === active ? 'on' : '' },
        el('span', { class: 'n' }, r.name), el('span', { class: 'd' }, r.detail));
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(r, 'search'); });
      return li;
    }));
    list.hidden = !results.length;
    input.setAttribute('aria-expanded', String(!!results.length));
    if (active >= 0) input.setAttribute('aria-activedescendant', `loc-opt-${active}`); else input.removeAttribute('aria-activedescendant');
  }
  async function runSearch(q) {
    const my = ++seq;
    status.textContent = 'Searching…';
    try {
      const c = cfg || await config();
      const bias = current ? { lat: current.latitude_deg, lon: current.longitude_deg } : null;
      let out;
      if (c.provider === 'google') { await loadGoogle(c.google_maps_key); out = await searchGoogle(q, bias); }
      else out = await searchPhoton(q, bias);
      if (my !== seq) return;
      results = out; active = out.length ? 0 : -1; renderList();
      status.textContent = out.length ? `${out.length} result${out.length > 1 ? 's' : ''} · Enter picks the first` : 'No place found. Try adding the city or area.';
    } catch (e) { if (my === seq) status.textContent = 'Search unavailable: ' + e.message; }
  }
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { results = []; closeList(); return; }
    timer = setTimeout(() => runSearch(q), 380);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && results.length) { active = (active + 1) % results.length; renderList(); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && results.length) { active = (active - 1 + results.length) % results.length; renderList(); e.preventDefault(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[active]) pick(results[active], 'search');
      else if (input.value.trim().length >= 3) { clearTimeout(timer); runSearch(input.value.trim()).then(() => results[0] && pick(results[0], 'search')); }
    } else if (e.key === 'Escape') closeList();
  });
  input.addEventListener('blur', () => setTimeout(closeList, 150));

  // --- device location ---------------------------------------------------------------------------------
  meBtn.addEventListener('click', () => {
    if (!navigator.geolocation) { status.textContent = 'This browser cannot share its location.'; return; }
    status.textContent = 'Waiting for location permission…';
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lon, accuracy } = pos.coords;
      const name = (cfg?.provider !== 'google' ? await reversePhoton(lat, lon) : null) || 'My location';
      pick({ name, detail: `±${Math.round(accuracy)} m`, lat, lon }, 'device');
    }, (err) => {
      status.textContent = err.code === 1 ? 'Location permission was denied. Search for a place instead.' : 'Could not get your location: ' + err.message;
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });

  // --- map ---------------------------------------------------------------------------------------------
  function setMarker(lat, lon) {
    if (!map) return;
    if (map.kind === 'google') {
      const pos = { lat, lng: lon };
      marker ? marker.setPosition(pos) : (marker = new google.maps.Marker({ position: pos, map: map.m }));
      map.m.panTo(pos);
    } else {
      marker ? marker.setLatLng([lat, lon]) : (marker = L.circleMarker([lat, lon], { radius: 7, color: '#f0c27a', weight: 2, fillColor: '#d8a24a', fillOpacity: 0.9 }).addTo(map.m));
      map.m.panTo([lat, lon]);
    }
  }
  async function openMap() {
    mapBox.hidden = false; mapBtn.setAttribute('aria-expanded', 'true');
    if (map) { if (map.kind === 'leaflet') map.m.invalidateSize(); return; }
    const c = cfg || await config();
    const lat = current?.latitude_deg ?? 12.97, lon = current?.longitude_deg ?? 77.59;
    try {
      if (c.provider === 'google') {
        await loadGoogle(c.google_maps_key);
        const m = new google.maps.Map(mapBox, { center: { lat, lng: lon }, zoom: 11, mapTypeId: 'roadmap', disableDefaultUI: false, streetViewControl: false });
        map = { kind: 'google', m };
        m.addListener('click', (e) => pick({ name: 'Picked on map', detail: '', lat: e.latLng.lat(), lon: e.latLng.lng() }, 'map'));
      } else {
        await loadLeaflet();
        const m = L.map(mapBox, { zoomControl: true, attributionControl: true }).setView([lat, lon], 11);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, className: 'osm-dark',
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(m);
        map = { kind: 'leaflet', m };
        m.on('click', async (e) => {
          const name = (await reversePhoton(e.latlng.lat, e.latlng.lng)) || 'Picked on map';
          pick({ name, detail: '', lat: e.latlng.lat, lon: e.latlng.lng }, 'map');
        });
      }
      if (current) setMarker(current.latitude_deg, current.longitude_deg);
      status.textContent = 'Click the map to observe from that spot.';
    } catch (e) { status.textContent = 'Map could not load: ' + (e.message || e); }
  }
  mapBtn.addEventListener('click', () => {
    if (mapBox.hidden) openMap(); else { mapBox.hidden = true; mapBtn.setAttribute('aria-expanded', 'false'); }
  });

  return {
    node,
    setPlace(p) { current = p; if (map && p) setMarker(p.latitude_deg, p.longitude_deg); },
  };
}
