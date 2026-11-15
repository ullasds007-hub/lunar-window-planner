import * as THREE from 'three';
import { el, rng } from '../util.js';

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2')) || !!c.getContext('webgl');
  } catch { return false; }
}

/** Renderer + demand-driven loop bound to a container. Pauses when off-screen or tab hidden. */
export function createStage(container, { antialias = true, shadows = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  if (shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  // The CSS size must be fixed to the container: setSize(..., false) only sets the drawing-buffer size,
  // and at display scaling above 100% an unsized canvas grows its container on every resize (runaway width).
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%', position: 'absolute', inset: '0' });
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.prepend(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (container.querySelector('.ctx-lost')) return;
    container.append(el('div', { class: 'loading ctx-lost' }, el('div', { class: 'inner' },
      'The browser paused this 3D view (graphics memory). ',
      el('button', { class: 'btn', type: 'button', style: 'pointer-events:auto;margin-top:8px', onclick: () => location.reload() }, 'Reload view'))));
  });

  const stage = {
    renderer, container, frameFns: new Set(), resizeFns: new Set(), running: true, visible: true,
    width: 1, height: 1, disposed: false,
  };

  const resize = () => {
    const r = container.getBoundingClientRect();
    stage.width = Math.max(1, Math.floor(r.width));
    stage.height = Math.max(1, Math.floor(r.height));
    renderer.setSize(stage.width, stage.height, false);
    stage.resizeFns.forEach((fn) => fn(stage.width, stage.height));
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  const io = new IntersectionObserver(([e]) => { stage.visible = e.isIntersecting; });
  io.observe(container);
  resize();

  let last = performance.now();
  const loop = (now) => {
    if (stage.disposed) return;
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!stage.visible || document.hidden) return;
    stage.frameFns.forEach((fn) => fn(dt, now));
  };
  requestAnimationFrame(loop);

  stage.dispose = () => {
    stage.disposed = true;
    ro.disconnect(); io.disconnect();
    renderer.dispose();
    renderer.forceContextLoss?.();
    renderer.domElement.remove();
  };
  return stage;
}

export function loadingOverlay(container, text = 'Loading…') {
  const node = el('div', { class: 'loading', role: 'status', 'aria-live': 'polite' }, el('div', { class: 'inner' }, text));
  container.append(node);
  return {
    set: (t) => { node.querySelector('.inner').textContent = t; },
    done: () => { node.classList.add('done'); setTimeout(() => node.remove(), 700); },
    error: (t) => { node.querySelector('.inner').textContent = t; node.classList.remove('done'); },
  };
}

export const LROC_CREDIT = 'Moon imagery and terrain: NASA/GSFC/Arizona State University (LROC)';
export const SIMPLIFIED_MOON = 'Simplified Moon: illustrative texture, not real imagery or terrain (LROC files not installed)';
export const SIMPLIFIED_GROUND = 'Simplified ground: flat illustrative surface, not real terrain (LROC files not installed)';

/** Small on-scene line: the LROC credit when LROC files are shown, or the simplified-view label. */
export function assetCredit(container) {
  const node = el('div', { class: 'asset-credit', role: 'note' });
  container.append(node);
  return {
    node,
    lroc() { node.textContent = LROC_CREDIT; node.classList.remove('simplified'); },
    simplified(text) { node.textContent = text; node.classList.add('simplified'); },
  };
}

/** Procedural grey Moon map (equirectangular). Illustrative only: it is not derived from any lunar data. */
let simplifiedMoon = null;
export function simplifiedMoonTexture() {
  if (simplifiedMoon) return simplifiedMoon;
  const w = 1024, h = 512, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8c8c88'; ctx.fillRect(0, 0, w, h);
  const r = rng(1969);
  for (let i = 0; i < 900; i++) {           // soft mottling and crater-like rings, randomly placed
    const x = r() * w, y = r() * h, rad = 2 + Math.pow(r(), 3) * 40, v = 110 + r() * 60;
    ctx.fillStyle = `rgba(${v},${v},${v - 4},0.18)`;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    if (rad > 8) { ctx.strokeStyle = 'rgba(200,200,196,0.18)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  simplifiedMoon = new THREE.CanvasTexture(c);
  simplifiedMoon.colorSpace = THREE.SRGBColorSpace;
  simplifiedMoon.wrapS = THREE.RepeatWrapping;
  return simplifiedMoon;
}

/** Plain regolith-grey ground map for the simplified terrain view. */
export function simplifiedGroundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7d7d79'; ctx.fillRect(0, 0, 256, 256);
  const r = rng(7);
  for (let i = 0; i < 400; i++) {
    const v = 105 + r() * 40;
    ctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
    ctx.beginPath(); ctx.arc(r() * 256, r() * 256, 1 + r() * 10, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function staticFallback(container, imgSrc, note) {
  const credit = el('div', { class: 'note' }, '3D view unavailable on this device · ' + note + ' · ' + LROC_CREDIT);
  const img = el('img', { src: imgSrc, alt: note });
  img.addEventListener('error', () => { img.remove(); credit.textContent = '3D view unavailable on this device · LROC imagery not installed'; });
  container.append(el('div', { class: 'fallback' }, img, credit));
}

/** Sparse, understated star field on a large sphere. */
export function makeStars(count = 1400, radius = 900, seed = 7) {
  const r = rng(seed);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    pos.set([radius * s * Math.cos(a), radius * z, radius * s * Math.sin(a)], i * 3);
    const m = Math.pow(r(), 3.2);                       // most stars faint
    const warm = r();
    const b = 0.18 + 0.82 * m;
    col.set([b * (0.92 + 0.08 * warm), b * 0.95, b * (1.05 - 0.1 * warm)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false });
  const p = new THREE.Points(g, m);
  p.renderOrder = -10;
  return p;
}

/** Procedural Earth texture (illustrative): oceans, land masses and cloud bands. */
let earthTex = null;
export function earthTexture() {
  if (earthTex) return earthTex;
  const w = 512, h = 256, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const r = rng(42);
  const grid = Array.from({ length: 33 }, () => Array.from({ length: 17 }, () => r()));
  const noise = (x, y, f) => {
    const gx = (x * f) % 32, gy = Math.min(15.999, y * f * 0.5);
    const x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0;
    const s = (t) => t * t * (3 - 2 * t);
    const g = (i, j) => grid[(i % 32 + 32) % 32][Math.min(16, j)];
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * s(tx);
    const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * s(tx);
    return a + (b - a) * s(ty);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    let n = 0, amp = 0.55, f = 2;
    for (let o = 0; o < 4; o++) { n += amp * noise(u * 16, v * 16, f / 2); amp *= 0.5; f *= 2; }
    const lat = Math.abs(v - 0.5) * 2;
    let cl = 0; amp = 0.6; f = 3;
    for (let o = 0; o < 4; o++) { cl += amp * noise(u * 16 + 7, v * 16 + 3, f / 2); amp *= 0.5; f *= 2; }
    cl = Math.max(0, cl - 0.52) * 2.4 + (lat > 0.82 ? 0.9 : 0);
    let rr, gg, bb;
    if (n > 0.56) { rr = 92; gg = 102; bb = 78; } else { rr = 22; gg = 52; bb = 96; }
    rr = rr + (235 - rr) * Math.min(1, cl); gg = gg + (240 - gg) * Math.min(1, cl); bb = bb + (245 - bb) * Math.min(1, cl);
    const i = (y * w + x) * 4;
    img.data[i] = rr; img.data[i + 1] = gg; img.data[i + 2] = bb; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  earthTex = new THREE.CanvasTexture(c);
  earthTex.colorSpace = THREE.SRGBColorSpace;
  return earthTex;
}

/** Earth: lit sphere + soft blue atmosphere rim that follows the Sun direction. */
export function makeEarth(radius) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 32),
    new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: 0.7, metalness: 0, emissive: 0x0b1a2e, emissiveIntensity: 0.05 }));
  group.add(body);
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.06, 64, 32),
    new THREE.ShaderMaterial({
      uniforms: { sunDir: { value: new THREE.Vector3(1, 0, 0) }, color: { value: new THREE.Color(0x86b6ff) } },
      vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform vec3 sunDir; uniform vec3 color; varying vec3 vN; varying vec3 vW;
        void main(){ vec3 v = normalize(cameraPosition - vW); float rim = pow(1.0 - max(dot(vN, v), 0.0), 2.6);
          float lit = smoothstep(-0.25, 0.4, dot(vN, normalize(sunDir)));
          gl_FragColor = vec4(color * rim * (0.15 + 1.1 * lit), rim * (0.2 + 0.8 * lit)); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    }));
  group.add(atmo);
  group.userData.setSun = (dir) => atmo.material.uniforms.sunDir.value.copy(dir);
  return group;
}

/** Soft glare sprite used for the Sun disc. */
export function makeGlow(color = 0xffffff, size = 1) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.12, 'rgba(255,250,235,0.95)');
  grd.addColorStop(0.3, 'rgba(255,240,210,0.25)');
  grd.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  return s;
}

export function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

/** Tiling regolith detail normal map (illustrative, below data resolution): small craters + grain. */
let regolith = null;
export function regolithNormalMap(size = 512, seed = 3) {
  if (regolith) return regolith;
  const r = rng(seed), h = new Float32Array(size * size);
  // grain: a few octaves of value noise via random sine sums
  for (let k = 0; k < 0; k++) {   // fine sine grain disabled: reads as ripples under grazing light
    const fx = Math.round(1 + r() * 24), fy = Math.round(1 + r() * 24), ph = r() * 6.28, a = 0.25 / (1 + (fx + fy) * 0.15);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
      h[y * size + x] += a * Math.sin(2 * Math.PI * (fx * x + fy * y) / size + ph);
  }
  // craterlets: bowl + raised rim, wrapped so the tile repeats seamlessly
  for (let c = 0; c < 160; c++) {
    const cx = r() * size, cy = r() * size, rad = 2 + Math.pow(r(), 3) * 22, depth = rad * 0.03;
    const R = Math.ceil(rad * 1.6);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy) / rad;
      if (d > 1.6) continue;
      const x = ((Math.floor(cx + dx) % size) + size) % size, y = ((Math.floor(cy + dy) % size) + size) % size;
      const v = d < 1 ? -depth * (1 - d * d) : depth * 0.35 * Math.exp(-((d - 1) * (d - 1)) / 0.08);
      h[y * size + x] += v;
    }
  }
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'), img = ctx.createImageData(size, size), s = 2.2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
    const hy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
    let nx = -hx * s, ny = hy * s, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * size + x) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  regolith = new THREE.CanvasTexture(c);
  regolith.wrapS = regolith.wrapT = THREE.RepeatWrapping;
  return regolith;
}
