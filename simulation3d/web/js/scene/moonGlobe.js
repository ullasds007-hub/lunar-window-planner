import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createStage, makeStars, makeEarth, easeInOut, assetCredit, simplifiedMoonTexture, SIMPLIFIED_MOON } from './common.js';
import { lonLatToVec, localFrame, fmtCoord, el, DEG } from '../util.js';
import { u } from '../api.js';

const MOON_RELIEF_EXAGGERATION = 2;            // GLD100 relief range ~19.4 km = 0.0112 radius
const DISPLACEMENT = 0.0112 * MOON_RELIEF_EXAGGERATION;
const EARTH_DISTANCE = 40;                     // scene units (Moon radius = 1)
const EARTH_RADIUS = EARTH_DISTANCE * 3.67 / 220;  // keeps Earth's true ~1.9 deg size as seen from the Moon

const CAP_EDGE_DEG = 79.9;          // caps cover the poles beyond this latitude
const SPHERE_CUT_DEG = 80.3;        // sphere discarded poleward of this (small overlap; cap drawn in front)
const R_M = 1737400;

let sharedTextures = null;
let sharedCaps = null;
function loadCaps() {
  if (sharedCaps) return sharedCaps;
  const tl = new THREE.TextureLoader();
  const tex = (u) => new Promise((res, rej) => tl.load(u, res, undefined, rej));
  const one = (pole) => Promise.all([
    fetch(u(`/assets/polar/${pole}/height.bin`)).then((r) => { if (!r.ok) throw new Error('cap'); return r.arrayBuffer(); }),
    fetch(u(`/assets/polar/${pole}/meta.json`)).then((r) => r.json()),
    tex(u(`/assets/polar/${pole}/albedo.png`)),
  ]).then(([buf, meta, albedo]) => ({ pole, h: new Float32Array(buf), meta, albedo }));
  sharedCaps = Promise.all([fetch(u('/assets/moon-meta.json')).then((r) => r.json()), one('south'), one('north')])
    .then(([moonMeta, south, north]) => ({ moonMeta, south, north }));
  sharedCaps.catch(() => { sharedCaps = null; });
  return sharedCaps;
}

/** Polar-cap grid (metres) -> lon/lat (deg). South: x = R cos(lat) sin(lon), y = R cos(lat) cos(lon). */
function capLonLat(x, y, pole) {
  const rho = Math.min(1, Math.hypot(x, y) / R_M);
  const lat = (pole === 'south' ? -1 : 1) * Math.acos(rho) / DEG;
  const lon = (pole === 'south' ? Math.atan2(x, y) : Math.atan2(x, -y)) / DEG;
  return [lon, lat];
}
function capXY(lon, lat, pole) {
  const c = Math.cos(lat * DEG) * R_M;
  return pole === 'south' ? [c * Math.sin(lon * DEG), c * Math.cos(lon * DEG)] : [c * Math.sin(lon * DEG), -c * Math.cos(lon * DEG)];
}
function loadMoonTextures(renderer) {
  if (sharedTextures) return sharedTextures;
  const loader = new THREE.TextureLoader();
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const load = (url, srgb) => new Promise((res, rej) => loader.load(url, (t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    t.wrapS = THREE.RepeatWrapping;
    res(t);
  }, undefined, rej));
  sharedTextures = Promise.all([
    load(u('/assets/moon/albedo.jpg'), true), load(u('/assets/moon/normal.png'), false), load(u('/assets/moon/height.png'), false),
  ]).then(([map, normalMap, displacementMap]) => ({ map, normalMap, displacementMap }))
    .catch(() => load(u('/app/images/nasa-moon-2k.jpg'), true).then(map => ({ map, nasa: true })));
  sharedTextures.catch(() => { sharedTextures = null; });
  return sharedTextures;
}

/**
 * Reusable 3D Moon.
 * opts: { sites: [{id,name,lat,lon}], selected, onSelect(id), autoRotate, interactive, onReady }
 */
export function createMoonGlobe(container, opts = {}) {
  const stage = createStage(container);
  const { renderer } = stage;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020306);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.0005, 3000);
  camera.position.set(0, -2.6, 2.6);

  const stars = makeStars(1500, 1200, 11);
  scene.add(stars);

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(1, 512, 256),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
  const vCut0 = ((90 - SPHERE_CUT_DEG) / 180).toFixed(5), vCut1 = ((90 + SPHERE_CUT_DEG) / 180).toFixed(5);
  moon.material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vLatV;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLatV = uv.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vLatV;')
      .replace('void main() {', 'void main() {\n  if (vLatV < ' + vCut0 + ' || vLatV > ' + vCut1 + ') discard;');
  };
  scene.add(moon);
  let heightToRadius = () => 1;      // replaced once the global height range is known
  const capHeight = {};              // pole -> (lon, lat) => metres

  const sun = new THREE.DirectionalLight(0xfff3e2, 3.0);
  scene.add(sun);
  const earthshine = new THREE.DirectionalLight(0x6f8fbf, 0.045);
  scene.add(earthshine);
  scene.add(new THREE.AmbientLight(0x1b2230, 0.05));

  const earth = makeEarth(EARTH_RADIUS);
  scene.add(earth);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 1.25;
  controls.maxDistance = 7;
  controls.rotateSpeed = 0.45;
  controls.zoomSpeed = 0.6;
  controls.autoRotate = !!opts.autoRotate;
  controls.autoRotateSpeed = 0.12;          // a full turn takes several minutes
  controls.enabled = opts.interactive !== false;

  // ---- site pins ------------------------------------------------------------------------
  const labels = el('div', { class: 'labels' });
  container.append(labels);
  const pins = new Map();
  const pinGeo = new THREE.SphereGeometry(0.0065, 16, 12);
  const stemGeo = new THREE.CylinderGeometry(0.0011, 0.0011, 0.035, 6);
  stemGeo.translate(0, 0.0175, 0);
  const matOn = new THREE.MeshBasicMaterial({ color: 0xf0c27a });
  const matOff = new THREE.MeshBasicMaterial({ color: 0xc9ccd2 });
  for (const s of opts.sites || []) {
    const surface = lonLatToVec(s.lon, s.lat, 1 + DISPLACEMENT * 0.55);
    const { up } = localFrame(s.lon, s.lat);
    const g = new THREE.Group();
    const stem = new THREE.Mesh(stemGeo, matOff);
    const head = new THREE.Mesh(pinGeo, matOff);
    head.position.y = 0.035;
    g.add(stem, head);
    g.position.copy(surface);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    g.userData.id = s.id;
    scene.add(g);
    const label = el('button', { class: 'pin-label', type: 'button', 'aria-label': `Select ${s.name}` },
      el('span', { class: 'site-dot' }), el('span', {}, s.name), el('span', { class: 'c' }, fmtCoord(s.lat, s.lon)));
    label.addEventListener('click', () => opts.onSelect?.(s.id));
    labels.append(label);
    pins.set(s.id, { group: g, head, stem, label, site: s, up, surface, tip: surface.clone().addScaledVector(up, 0.035) });
  }
  function seatPins() {
    for (const p of pins.values()) {
      const pole = p.site.lat < 0 ? 'south' : 'north';
      if (!capHeight[pole] || Math.abs(p.site.lat) < CAP_EDGE_DEG) continue;
      const r = heightToRadius(capHeight[pole](p.site.lon, p.site.lat));
      p.surface = lonLatToVec(p.site.lon, p.site.lat, r);
      p.group.position.copy(p.surface);
      p.tip = p.surface.clone().addScaledVector(p.up, 0.035);
    }
  }

  // With many sites, only the selected (and hovered) pin carries a text label, so labels never pile up
  let selectedId = opts.selected, hoveredId = null;
  const MANY = 6;
  function setSelected(id) {
    selectedId = id;
    for (const [pid, p] of pins) {
      const on = pid === id;
      p.head.material = p.stem.material = on ? matOn : matOff;
      p.label.classList.toggle('selected', on);
      p.head.scale.setScalar(on ? 1.35 : 1);
    }
  }
  setSelected(opts.selected);

  // click on 3D pin heads
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...pins.values()].map((p) => p.head));
    const id = hits.length ? hits[0].object.parent.userData.id : hoveredId;
    if (id) opts.onPinClick ? opts.onPinClick(id) : opts.onSelect?.(id);
  });
  // hover: nearest pin within 16 px of the pointer reveals its label
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (pins.size <= MANY || e.buttons) return;
    const r = renderer.domElement.getBoundingClientRect();
    let best = null, bestD = 16;
    for (const [id, p] of pins) {
      v.copy(p.tip).project(camera);
      if (v.z >= 1) continue;
      const d = Math.hypot((v.x * 0.5 + 0.5) * r.width - (e.clientX - r.left), (-v.y * 0.5 + 0.5) * r.height - (e.clientY - r.top));
      if (d < bestD) { bestD = d; best = id; }
    }
    hoveredId = best;
    renderer.domElement.style.cursor = best ? 'pointer' : '';
  });
  renderer.domElement.addEventListener('pointerleave', () => { hoveredId = null; });

  // ---- geometry: Sun and Earth directions in the Moon-fixed frame ----------------------------
  const sunDir = new THREE.Vector3(1, 0, 0);
  const earthDir = new THREE.Vector3(1, 0, 0);
  function setSun(lon, lat) {
    lonLatToVec(lon, lat, 1, sunDir).normalize();
    sun.position.copy(sunDir).multiplyScalar(10);
    earth.userData.setSun(sunDir);
  }
  function setEarth(lon, lat) {
    lonLatToVec(lon, lat, 1, earthDir).normalize();
    earth.position.copy(earthDir).multiplyScalar(EARTH_DISTANCE);
    earthshine.position.copy(earthDir).multiplyScalar(10);
    earth.rotation.y = -Math.atan2(earthDir.z, earthDir.x);
  }
  setSun(110, -1.4);
  setEarth(355, -0.3);

  // ---- camera framing & flight ------------------------------------------------------------
  function frameSouthPole(distance = 4.6, latDeg = -70, lonDeg = null, targetY = -0.28) {
    lastFrame = [distance, latDeg, lonDeg, targetY];
    userMoved = false;
    // Default: look at the south polar region from the sunlit side, Earth near the limb when possible.
    const sunLon = Math.atan2(sunDir.z, -sunDir.x) / DEG - 180;   // inverse of lonLatToVec
    const lon = lonDeg ?? (sunLon + 35);
    const halfV = (camera.fov / 2) * DEG, halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    distance = Math.max(distance, 1.18 / Math.sin(Math.min(halfV, halfH)));   // whole disc fits on narrow screens
    camera.position.copy(lonLatToVec(lon, latDeg, distance));
    controls.target.set(0, targetY, 0);
    camera.up.set(0, 1, 0);
    camera.lookAt(controls.target);
    controls.update();
  }

  let flight = null;
  const saved = { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
  const headingTo = (site, azDeg) => {
    const f = localFrame(site.lon, site.lat);
    const a = azDeg * DEG;
    return f.north.clone().multiplyScalar(Math.cos(a)).addScaledVector(f.east, Math.sin(a)).normalize();
  };

  function flyToSite(id, { headingDeg = 0, duration = 2.6, onArrive } = {}) {
    const p = pins.get(id);
    if (!p) return;
    saved.pos.copy(camera.position); saved.target.copy(controls.target); saved.up.copy(camera.up);
    const surf = p.surface.clone();
    const head = headingTo(p.site, headingDeg);
    const endPos = surf.clone().addScaledVector(p.up, 0.004);
    const endTarget = endPos.clone().addScaledVector(head, 0.2).addScaledVector(p.up, 0.004);
    flight = {
      t: 0, duration, onArrive,
      fromPos: camera.position.clone(), toPos: endPos,
      fromTarget: controls.target.clone(), toTarget: endTarget,
      fromUp: camera.up.clone(), toUp: p.up.clone(),
      fromDist: camera.position.length(), toDist: endPos.length(),
    };
    controls.enabled = false;
    controls.autoRotate = false;
  }

  function flyBack({ duration = 2.2, onArrive } = {}) {
    flight = {
      t: 0, duration, onArrive,
      fromPos: camera.position.clone(), toPos: saved.pos.clone(),
      fromTarget: controls.target.clone(), toTarget: saved.target.clone(),
      fromUp: camera.up.clone(), toUp: saved.up.clone(),
      fromDist: camera.position.length(), toDist: saved.pos.length(),
      back: true,
    };
  }

  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  function stepFlight(dt) {
    flight.t = Math.min(1, flight.t + dt / flight.duration);
    const k = easeInOut(flight.t);
    // direction along a great circle, radius eased separately (descends late, climbs early)
    const da = tmpA.copy(flight.fromPos).normalize(), db = tmpB.copy(flight.toPos).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(da, db);
    const qk = new THREE.Quaternion().slerp(q, Math.min(1, k * 1.25));
    const dir = da.clone().applyQuaternion(qk);
    const rk = flight.back ? Math.pow(k, 0.6) : Math.pow(k, 1.8);
    const r = flight.fromDist + (flight.toDist - flight.fromDist) * rk;
    camera.position.copy(dir.multiplyScalar(r));
    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, flight.back ? k : Math.pow(k, 1.6));
    camera.up.lerpVectors(flight.fromUp, flight.toUp, k).normalize();
    camera.lookAt(controls.target);
    if (flight.t >= 1) {
      const f = flight; flight = null;
      if (f.back) { controls.enabled = opts.interactive !== false; camera.up.set(0, 1, 0); controls.update(); }
      f.onArrive?.();
    }
  }

  // ---- per-frame ----------------------------------------------------------------------------
  const v = new THREE.Vector3(), toCam = new THREE.Vector3();
  function placeLabels() {
    const placed = [];
    for (const p of pins.values()) {
      toCam.copy(camera.position).sub(p.tip);
      const facing = toCam.dot(p.up) > 0.02 && p.tip.distanceTo(camera.position) > 0.02;
      v.copy(p.tip).project(camera);
      const x = (v.x * 0.5 + 0.5) * stage.width, y = (-v.y * 0.5 + 0.5) * stage.height;
      const named = pins.size <= MANY || p.site.id === selectedId || p.site.id === hoveredId;
      const show = named && facing && v.z < 1 && x > -40 && x < stage.width + 40 && y > -20 && y < stage.height + 20 && !flight;
      p.label.classList.toggle('hidden', !show);
      p.label.tabIndex = show ? 0 : -1;
      let ly = y;
      for (const q of placed) if (Math.abs(q.x - x) < 260 && Math.abs(q.y - ly) < 28) ly = q.y + (ly >= q.y ? 28 : -28);
      if (show) placed.push({ x, y: ly });
      const w = p.label.offsetWidth || 220;
      p.label.classList.toggle('flip', x + 10 + w > stage.width - 8 && x - 10 - w > 8);
      p.label.style.left = `${x}px`; p.label.style.top = `${ly}px`;
    }
  }

  let userMoved = false, lastFrame = null;
  controls.addEventListener('start', () => { userMoved = true; });
  stage.resizeFns.add((w, h) => {
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (lastFrame && !userMoved && !flight) frameSouthPole(...lastFrame);   // keep the whole Moon in view
  });
  camera.aspect = stage.width / stage.height; camera.updateProjectionMatrix();
  stage.frameFns.add((dt) => {
    if (flight) stepFlight(dt); else controls.update();
    stars.position.copy(camera.position);
    placeLabels();
    renderer.render(scene, camera);
  });

  const credit = assetCredit(container);
  let assetMode = 'loading';
  const wholeSphere = () => { moon.material.onBeforeCompile = () => { /* no polar cut: no caps */ }; moon.material.needsUpdate = true; };
  const ready = loadMoonTextures(renderer).then((t) => {
    if (t.nasa) {
      assetMode = 'nasa';
      moon.material.map = t.map;
      wholeSphere();
      credit.nasa();
      return null;
    }
    Object.assign(moon.material, {
      map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1),
      displacementMap: t.displacementMap, displacementScale: DISPLACEMENT, displacementBias: -DISPLACEMENT * 0.45,
    });
    moon.material.needsUpdate = true;
    assetMode = 'lroc';
    credit.lroc();
    return loadCaps().catch(() => null);
  }, () => {
    // LROC files not installed: labelled illustrative Moon, smooth sphere, no polar caps
    assetMode = 'simplified';
    moon.material.map = simplifiedMoonTexture();
    wholeSphere();
    credit.simplified(SIMPLIFIED_MOON);
    return null;
  }).then((caps) => {
    if (!caps) { if (assetMode === 'lroc') wholeSphere(); opts.onReady?.(); return; }
    const { height_min_m: hmin, height_max_m: hmax } = caps.moonMeta;
    heightToRadius = (h) => 1 + ((h - hmin) / (hmax - hmin) - 0.45) * DISPLACEMENT;
    for (const cap of [caps.south, caps.north]) {
      const { n, half_m: half } = cap.meta, px = (2 * half) / n;
      const rhoMax = Math.cos(CAP_EDGE_DEG * DEG) * R_M;
      const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), inside = new Uint8Array(n * n);
      const v3 = new THREE.Vector3();
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const i = r * n + c, x = -half + (c + 0.5) * px, y = half - (r + 0.5) * px;
        inside[i] = Math.hypot(x, y) <= rhoMax ? 1 : 0;
        const [lon, lat] = capLonLat(x, y, cap.pole);
        lonLatToVec(lon, lat, heightToRadius(cap.h[i]), v3);
        pos.set([v3.x, v3.y, v3.z], i * 3);
        uv.set([(c + 0.5) / n, 1 - (r + 0.5) / n], i * 2);
      }
      const idx = [];
      for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
        const a = r * n + c, b = a + 1, d = a + n, e = d + 1;
        if (inside[a] && inside[b] && inside[d] && inside[e]) idx.push(a, d, b, b, d, e);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      // Shading normals with the same slope gain as the globe's normal map (moon_meta.normal_gain),
      // so the cap and the sphere read alike; geometry itself keeps the x2 relief.
      const gain = (caps.moonMeta.normal_gain ?? 6) * 0.7;
      // light 5x5 box blur of heights for shading only (suppresses interpolation ripples in the polar fill)
      const hs = new Float32Array(n * n);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        let sum = 0, cnt = 0;
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < n && cc >= 0 && cc < n) { sum += cap.h[rr * n + cc]; cnt++; }
        }
        hs[r * n + c] = sum / cnt;
      }
      const edgeR0 = Math.cos((CAP_EDGE_DEG + 1.2) * DEG) * R_M, edgeR1 = rhoMax;
      const nrm = new Float32Array(n * n * 3), up = new THREE.Vector3(), ex = new THREE.Vector3(), ey = new THREE.Vector3();
      const P = (x, y, out) => { const [lo, la] = capLonLat(x, y, cap.pole); return lonLatToVec(lo, la, 1, out); };
      const t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const i = r * n + c, x = -half + (c + 0.5) * px, y = half - (r + 0.5) * px;
        P(x, y, up).normalize();
        ex.copy(P(x + px, y, t1)).sub(P(x - px, y, t2)).normalize();
        ey.copy(P(x, y + px, t1)).sub(P(x, y - px, t2)).normalize();
        const cl = Math.max(1, Math.min(n - 2, c)), rl = Math.max(1, Math.min(n - 2, r));
        const dhdx = (hs[rl * n + cl + 1] - hs[rl * n + cl - 1]) / (2 * px);
        const dhdy = (hs[(rl - 1) * n + cl] - hs[(rl + 1) * n + cl]) / (2 * px);
        const rho = Math.hypot(x, y);
        const fade = 1 - 0.6 * Math.min(1, Math.max(0, (rho - edgeR0) / (edgeR1 - edgeR0)));   // soften toward the globe
        const v = up.clone().addScaledVector(ex, -gain * fade * dhdx).addScaledVector(ey, -gain * fade * dhdy).normalize();
        nrm.set([v.x, v.y, v.z], i * 3);
      }
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      cap.albedo.colorSpace = THREE.SRGBColorSpace;
      cap.albedo.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        map: cap.albedo, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        side: THREE.DoubleSide }));
      scene.add(mesh);
      capHeight[cap.pole] = (lon, lat) => {
        const [x, y] = capXY(lon, lat, cap.pole);
        const fc = (x + half) / px - 0.5, fr = (half - y) / px - 0.5;
        const c0 = Math.max(0, Math.min(n - 2, Math.floor(fc))), r0 = Math.max(0, Math.min(n - 2, Math.floor(fr)));
        const tc = fc - c0, tr = fr - r0, H = (rr, cc) => cap.h[rr * n + cc];
        return (H(r0, c0) * (1 - tc) + H(r0, c0 + 1) * tc) * (1 - tr) + (H(r0 + 1, c0) * (1 - tc) + H(r0 + 1, c0 + 1) * tc) * tr;
      };
    }
    seatPins();
    opts.onReady?.();
  });

  return {
    stage, scene, camera, controls, ready, setSun, setEarth, setSelected, frameSouthPole, flyToSite, flyBack,
    get flying() { return !!flight; },
    setAutoRotate: (on) => { controls.autoRotate = on; },
    reliefExaggeration: MOON_RELIEF_EXAGGERATION,
    get assetMode() { return assetMode; },
    dispose: () => { stage.dispose(); labels.remove(); credit.node.remove(); },
  };
}
