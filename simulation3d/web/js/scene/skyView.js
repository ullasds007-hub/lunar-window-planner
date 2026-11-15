import * as THREE from 'three';
import { createStage, makeStars } from './common.js';
import { azElToDir, rng, DEG } from '../util.js';
import { u } from '../api.js';

const MOON_DIST = 1000;
export const MOON_ENLARGE = 12;                      // the Moon is drawn 12x its true angular size
const MOON_R = MOON_DIST * Math.tan(0.259 * DEG) * MOON_ENLARGE;

/** Greenwich mean sidereal time (deg) from Unix ms (IAU 1982, good to ~0.1 s here). */
export function gmstDeg(ms) {
  const jd = ms / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;
  const g = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - (t * t * t) / 38710000;
  return ((g % 360) + 360) % 360;
}

let moonTex = null;
function moonTextures() {
  if (!moonTex) {
    const l = new THREE.TextureLoader();
    const ld = (u) => new Promise((res, rej) => l.load(u, res, undefined, rej));
    moonTex = Promise.all([ld(u('/assets/moon/albedo.jpg')), ld(u('/assets/moon/normal.png'))]);
  }
  return moonTex;
}

/**
 * Night-sky view from a place on Earth. Moon/Sun alt-az come from the Level 1 engine (Skyfield).
 * The Moon sphere is lit from the true Sun direction, so its illuminated phase and the tilt of the
 * bright limb follow the real Sun-Moon-observer geometry.
 */
export function createSkyView(container, { latDeg = 0 } = {}) {
  const stage = createStage(container);
  const { renderer } = stage;
  renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.5, 5000);

  // sky dome
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { sunDir: { value: new THREE.Vector3(0, -1, 0) }, sunAlt: { value: -30 } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 sunDir; uniform float sunAlt; varying vec3 vD;
      void main(){
        float h = max(vD.y, 0.0);
        float day = smoothstep(-8.0, 6.0, sunAlt);
        float twi = smoothstep(-18.0, -4.0, sunAlt) * (1.0 - smoothstep(0.0, 10.0, sunAlt));
        vec3 night = mix(vec3(0.010,0.014,0.024), vec3(0.004,0.006,0.012), h);
        vec3 dayc = mix(vec3(0.42,0.58,0.78), vec3(0.16,0.32,0.62), pow(h, 0.6));
        vec3 c = mix(night, dayc, day);
        float toward = max(dot(normalize(vec3(vD.x,0.,vD.z)), normalize(vec3(sunDir.x,0.,sunDir.z))), 0.0);
        float band = exp(-h * 7.0);
        c += twi * band * (vec3(0.55,0.30,0.14) * pow(toward, 3.0) + vec3(0.05,0.07,0.13));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), skyMat);
  scene.add(sky);

  // stars on the celestial sphere, rotated by sidereal time around the celestial pole
  const starPivot = new THREE.Group();
  const stars = makeStars(1700, 2500, 5);
  starPivot.add(stars);
  scene.add(starPivot);

  // ground with a low irregular horizon (illustrative silhouette)
  const ground = new THREE.Mesh(new THREE.CircleGeometry(2600, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x14171b, roughness: 1 }));
  ground.position.y = -1.6;
  scene.add(ground);
  const r = rng(9);
  const N = 256, ridge = new THREE.BufferGeometry(), verts = [], idx = [];
  const hgt = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    let h = 0;
    for (let k = 1; k <= 6; k++) h += (Math.sin(a * k * 3 + r() * 6) + 1) * (14 / k);
    hgt.push(6 + h * 0.9 + (r() * 2));
  }
  hgt[N] = hgt[0];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2, d = 2200;
    verts.push(Math.sin(a) * d, -1.6, -Math.cos(a) * d, Math.sin(a) * d, hgt[i], -Math.cos(a) * d);
    if (i < N) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  ridge.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  ridge.setIndex(idx); ridge.computeVertexNormals();
  scene.add(new THREE.Mesh(ridge, new THREE.MeshStandardMaterial({ color: 0x0f1215, roughness: 1, side: THREE.DoubleSide })));

  // Moon
  const moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_R, 96, 48),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, emissive: 0x0a0d12, emissiveIntensity: 1 }));
  scene.add(moon);
  const moonSun = new THREE.DirectionalLight(0xfff6ea, 6.0);   // sunlight (lights the Moon's day side)
  scene.add(moonSun, moonSun.target);
  const groundLight = new THREE.DirectionalLight(0xbfcbe0, 0);   // moon/sun light on the ground
  scene.add(groundLight);
  const amb = new THREE.AmbientLight(0x8aa0c0, 0.02);
  scene.add(amb);

  moonTextures().then(([map, normalMap]) => {
    map.colorSpace = THREE.SRGBColorSpace;
    Object.assign(moon.material, { map, normalMap, normalScale: new THREE.Vector2(0.6, 0.6) });
    moon.material.needsUpdate = true;
  }).catch(() => {});

  const view = { follow: true, yaw: 180, pitch: 15, moonAz: 180, moonAlt: 0, lat: latDeg, snap: true };
  const moonDir = new THREE.Vector3(), sunDir = new THREE.Vector3();
  const poleDir = new THREE.Vector3();

  function setLatitude(lat) { view.lat = lat; view.snap = true; }   // new place/night: re-aim at the Moon

  /** sky state at an instant: alt/az of Moon and Sun, plus time (for star rotation). */
  function setSky({ moonAlt, moonAz, sunAlt, sunAz, ms, lonDeg = 0, illumination = 50 }) {
    view.moonAz = moonAz; view.moonAlt = moonAlt; view.hasSky = true;
    azElToDir(moonAz, moonAlt, moonDir);
    azElToDir(sunAz, sunAlt, sunDir);
    moon.position.copy(moonDir).multiplyScalar(MOON_DIST);
    // orient: near side (+x of the Moon mesh) toward the observer, Moon north toward the celestial pole
    azElToDir(0, view.lat, poleDir);   // north celestial pole: due north at altitude = latitude
    const xAxis = moonDir.clone().negate();
    const yAxis = poleDir.clone().sub(xAxis.clone().multiplyScalar(poleDir.dot(xAxis))).normalize();
    const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
    moon.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    // Sun at infinity: direction from Moon to Sun ~ observer-to-Sun direction (error < 0.2 deg)
    moonSun.position.copy(moon.position).addScaledVector(sunDir, 500);
    moonSun.target.position.copy(moon.position);
    moonSun.target.updateMatrixWorld();
    skyMat.uniforms.sunDir.value.copy(sunDir);
    skyMat.uniforms.sunAlt.value = sunAlt;
    // ground light: sunlight by day, faint moonlight by night
    if (moonAlt > 0 && sunAlt < -1) { groundLight.position.copy(moonDir); groundLight.intensity = 0.12 * (illumination / 100); groundLight.color.set(0xbfcbe0); }
    else groundLight.intensity = 0;
    amb.intensity = 0.02 + 0.5 * Math.max(0, Math.min(1, (sunAlt + 6) / 12));
    // stars: visible only in a dark sky, rotating with local sidereal time
    const dark = Math.max(0, Math.min(1, (-sunAlt - 4) / 10));
    stars.material.opacity = 0.9 * dark;
    starPivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), poleDir.clone().normalize());
    const lst = (gmstDeg(ms) + lonDeg) * DEG;
    stars.rotation.y = -lst;
  }

  // look around: drag; "follow" keeps the Moon framed
  let drag = null;
  const dom = renderer.domElement;
  dom.style.cursor = 'grab';
  dom.tabIndex = 0;
  dom.setAttribute('aria-label', 'Sky view. Drag or use arrow keys to look around.');
  dom.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch }; view.follow = false; dom.setPointerCapture(e.pointerId); onFollow?.(false); });
  dom.addEventListener('pointermove', (e) => {
    if (!drag) return;
    view.yaw = drag.yaw - (e.clientX - drag.x) * 0.15;
    view.pitch = Math.max(-5, Math.min(80, drag.pitch + (e.clientY - drag.y) * 0.12));
  });
  dom.addEventListener('pointerup', () => { drag = null; });
  dom.addEventListener('keydown', (e) => {
    const s = e.shiftKey ? 10 : 3;
    if (e.key === 'ArrowLeft') view.yaw -= s; else if (e.key === 'ArrowRight') view.yaw += s;
    else if (e.key === 'ArrowUp') view.pitch = Math.min(80, view.pitch + 2); else if (e.key === 'ArrowDown') view.pitch = Math.max(-5, view.pitch - 2);
    else return;
    view.follow = false; onFollow?.(false); e.preventDefault();
  });
  let onFollow = null;

  const look = new THREE.Vector3();
  stage.resizeFns.add((w, h) => { camera.aspect = w / h; camera.updateProjectionMatrix(); });
  camera.aspect = stage.width / stage.height; camera.updateProjectionMatrix();
  stage.frameFns.add((dt) => {
    if (view.follow) {
      const targetPitch = Math.max(12, Math.min(72, view.moonAlt * 0.85 + 6));
      if (view.snap && view.hasSky) { view.yaw = view.moonAz; view.pitch = targetPitch; view.snap = false; }
      let dy = ((view.moonAz - view.yaw + 540) % 360) - 180;
      view.yaw += dy * Math.min(1, dt * 1.5);
      view.pitch += (targetPitch - view.pitch) * Math.min(1, dt * 1.5);
    }
    camera.position.set(0, 0, 0);
    azElToDir(view.yaw, view.pitch, look);
    camera.lookAt(look);
    renderer.render(scene, camera);
  });

  return {
    stage, setSky, setLatitude, view,
    follow: (on = true) => { view.follow = on; },
    onFollowChange: (fn) => { onFollow = fn; },
    dispose: () => stage.dispose(),
  };
}
