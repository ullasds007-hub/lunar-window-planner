import * as THREE from 'three';
import { createStage, makeStars, makeEarth, makeGlow, regolithNormalMap } from './common.js';
import { azElToDir, rng, DEG } from '../util.js';
import { api } from '../api.js';

const R_MOON = 1737400;          // m
const SKY_R = 120000;            // m: distance at which Sun/Earth are drawn (beyond the terrain)
const EYE_HEIGHT = 8;            // m above local ground

/**
 * Ground-level lunar scene at a site, from real LROC heights + albedo, lit by the real Sun direction.
 * Fine relief below the 117 m data spacing is added as low-amplitude procedural noise (illustrative).
 */
export function createTerrainView(container, { siteId, headingDeg = 0, onReady, onError, shadowSize = 4096 } = {}) {
  const stage = createStage(container, { shadows: true });
  const { renderer } = stage;
  renderer.toneMappingExposure = 1.35;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(52, 1, 1, 400000);

  const stars = makeStars(1100, 300000, 23);
  scene.add(stars);

  const sun = new THREE.DirectionalLight(0xfffbf6, 5.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = sun.shadow.camera;
  sc.left = -17000; sc.right = 17000; sc.top = 17000; sc.bottom = -17000; sc.near = 1000; sc.far = 90000;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 12;
  scene.add(sun, sun.target);
  const earthLight = new THREE.DirectionalLight(0x9fb6d8, 0.22);
  scene.add(earthLight);
  scene.add(new THREE.AmbientLight(0x2a3240, 0.05));
  // Visualization fill: only when the Sun is below the horizon, so the terrain stays readable in lunar night.
  // Not a physical light source; the page labels it whenever it is on.
  const visFill = new THREE.HemisphereLight(0x9fb2d6, 0x1a1c20, 0);
  scene.add(visFill);

  const sunGlow = makeGlow(0xfff4dc, 1);
  scene.add(sunGlow);
  const earth = makeEarth(SKY_R * 3.67 / 220);
  scene.add(earth);

  const view = { yaw: headingDeg, pitch: 1.5, groundY: 0, meta: null, sunEl: 0, earthEl: 0 };

  // look-around by dragging
  let drag = null;
  const el = renderer.domElement;
  el.style.cursor = 'grab';
  el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch }; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    view.yaw = drag.yaw - (e.clientX - drag.x) * 0.12;
    view.pitch = Math.max(-12, Math.min(40, drag.pitch + (e.clientY - drag.y) * 0.08));
  });
  const end = () => { drag = null; el.style.cursor = 'grab'; };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.tabIndex = 0;
  el.setAttribute('aria-label', 'Ground-level lunar view. Drag or use arrow keys to look around.');
  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 3;
    if (e.key === 'ArrowLeft') view.yaw -= step; else if (e.key === 'ArrowRight') view.yaw += step;
    else if (e.key === 'ArrowUp') view.pitch = Math.min(40, view.pitch + 1); else if (e.key === 'ArrowDown') view.pitch = Math.max(-12, view.pitch - 1);
    else return;
    e.preventDefault();
  });

  // ---- build terrain from data -----------------------------------------------------------------
  const ready = Promise.all([api.terrainMeta(siteId), api.terrainHeights(siteId),
    new Promise((res, rej) => new THREE.TextureLoader().load(api.terrainAlbedoUrl(siteId), res, undefined, rej))])
    .then(([meta, heights, albedo]) => {
      view.meta = meta;
      const n0 = meta.rows, up = 2, n = (n0 - 1) * up + 1, size = meta.size_m, base = meta.site_height_m;
      const r = rng(Math.round(Math.abs(meta.lat * 1000 + meta.lon * 10)));
      // procedural micro-relief (metres), sum of a few random sine waves: below data resolution only
      const waves = Array.from({ length: 10 }, (_, i) => ({
        kx: (r() - 0.5) * 2, kz: (r() - 0.5) * 2, f: 2 * Math.PI / (35 + 220 * Math.pow(r(), 1.5)), p: r() * 6.28,
        a: 0.6 + 2.4 * r() * (i < 4 ? 1 : 0.5),
      }));
      const geo = new THREE.PlaneGeometry(size, size, n - 1, n - 1);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const H = (row, col) => heights[Math.min(n0 - 1, row) * n0 + Math.min(n0 - 1, col)];
      for (let i = 0; i < pos.count; i++) {
        const row = Math.floor(i / n), col = i % n;
        const fr = row / up, fc = col / up, r0 = Math.floor(fr), c0 = Math.floor(fc), tr = fr - r0, tc = fc - c0;
        const h = (H(r0, c0) * (1 - tc) + H(r0, c0 + 1) * tc) * (1 - tr) + (H(r0 + 1, c0) * (1 - tc) + H(r0 + 1, c0 + 1) * tc) * tr;
        const x = pos.getX(i), z = pos.getZ(i);
        let micro = 0;
        for (const w of waves) micro += w.a * Math.sin((w.kx * x + w.kz * z) * w.f + w.p);
        const d2 = x * x + z * z;
        pos.setY(i, h - base + micro * 0.06 - d2 / (2 * R_MOON));    // lunar curvature drop; micro-relief kept faint
      }
      geo.computeVertexNormals();
      albedo.colorSpace = THREE.SRGBColorSpace;
      albedo.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const detail = regolithNormalMap().clone();
      detail.needsUpdate = true;
      detail.repeat.set(size / 23, size / 23);          // one 512 px tile per 23 m
      detail.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        map: albedo, color: 0xdadad8, roughness: 1, metalness: 0, normalMap: detail, normalScale: new THREE.Vector2(0.18, 0.18) }));
      ground.castShadow = true; ground.receiveShadow = true;
      scene.add(ground);

      // beyond the data: a dark curved skirt so nothing shows "under" the horizon
      const skirt = new THREE.Mesh(new THREE.RingGeometry(size * 0.48, 90000, 96, 8), new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 1 }));
      skirt.rotateX(-Math.PI / 2);
      const sp = skirt.geometry.attributes.position;
      for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), y = sp.getY(i); sp.setZ(i, -(x * x + y * y) / (2 * R_MOON) - 40); }
      skirt.geometry.computeVertexNormals();
      skirt.receiveShadow = true;
      scene.add(skirt);

      // eye height above the actual ground at the centre
      const ci = Math.floor(pos.count / 2);
      view.groundY = pos.getY(ci);
      onReady?.(meta);
    })
    .catch((e) => { onError?.(e); throw e; });

  // ---- time-dependent sky ------------------------------------------------------------------------
  const sunDir = new THREE.Vector3(), earthDir = new THREE.Vector3();
  function setSky({ sunAz, sunEl, earthAz, earthEl }) {
    view.sunEl = sunEl; view.earthEl = earthEl;
    azElToDir(sunAz, sunEl, sunDir);
    azElToDir(earthAz, earthEl, earthDir);
    sun.position.copy(sunDir).multiplyScalar(40000);
    sun.target.position.set(0, 0, 0);
    sun.intensity = sunEl > -0.3 ? 5.2 * Math.min(1, (sunEl + 0.3) / 0.6) : 0;   // limb sets over ~0.5 deg
    earthLight.position.copy(earthDir).multiplyScalar(40000);
    earthLight.intensity = earthEl > 0 ? 0.22 * Math.min(1, (earthEl + 0.5) / 1.5) : 0.0;   // earthshine
    earth.userData.setSun(sunDir);
    const night = Math.max(0, Math.min(1, (0.3 - sunEl) / 0.6));   // ramps in as the Sun's limb sets
    visFill.intensity = 2.4 * night;
    view.visFill = night > 0.01;
  }

  const look = new THREE.Vector3();
  stage.resizeFns.add((w, h) => { camera.aspect = w / h; camera.updateProjectionMatrix(); });
  camera.aspect = stage.width / stage.height; camera.updateProjectionMatrix();
  stage.frameFns.add(() => {
    camera.position.set(0, view.groundY + EYE_HEIGHT, 0);
    azElToDir(view.yaw, view.pitch, look);
    camera.lookAt(look.add(camera.position));
    sunGlow.position.copy(camera.position).addScaledVector(sunDir, SKY_R);
    const glowSize = 2 * SKY_R * Math.tan(0.27 * DEG) * 9;
    sunGlow.scale.setScalar(glowSize);
    earth.position.copy(camera.position).addScaledVector(earthDir, SKY_R);
    stars.position.copy(camera.position);
    renderer.render(scene, camera);
  });

  return {
    stage, ready, setSky, view,
    setHeading: (az) => { view.yaw = az; },
    dispose: () => stage.dispose(),
  };
}
