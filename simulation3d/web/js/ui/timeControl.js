import { el, fmtUTC } from '../util.js';
import { prefersReducedMotion } from '../state.js';

/**
 * Shared time control: Play/Pause, Reset, a scrubber over [start, end] and a speed selector.
 * Owns the authoritative time for the views it drives; views read it through onTime callbacks.
 */
export function createTimeControl({ start, end, time, speeds, speedIndex = 1, format = fmtUTC, label = 'Scenario time' }) {
  const listeners = new Set();
  const actionListeners = new Set();
  const action = () => actionListeners.forEach((fn) => fn());
  const ctl = { time, playing: false, start, end, speed: speeds[speedIndex].hoursPerSecond };

  const playBtn = el('button', { class: 'btn icon', type: 'button', 'aria-label': 'Play', title: 'Play / pause (Space)' });
  const resetBtn = el('button', { class: 'btn', type: 'button' }, 'Reset');
  const clock = el('div', { class: 'clock', 'aria-live': 'off' });
  const range = el('input', { type: 'range', min: 0, max: 1000, step: 1, 'aria-label': label });
  const speedSel = el('select', { class: 'speed', 'aria-label': 'Playback speed' },
    speeds.map((s, i) => el('option', { value: i, selected: i === speedIndex }, s.label)));
  const rel = el('div', { class: 'rel' });
  const node = el('div', { class: 'timebar' }, playBtn, resetBtn, range, clock, speedSel);

  const icon = (playing) => playing
    ? '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" fill="currentColor"/><rect x="8.5" y="1" width="3.5" height="12" fill="currentColor"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9-5.5z" fill="currentColor"/></svg>';

  let renderedPlaying;
  const render = () => {
    // Keep the button's SVG mounted between animation ticks so it remains clickable.
    if (renderedPlaying !== ctl.playing) {
      renderedPlaying = ctl.playing;
      playBtn.innerHTML = icon(ctl.playing);
      playBtn.setAttribute('aria-label', ctl.playing ? 'Pause' : 'Play');
      playBtn.setAttribute('aria-pressed', String(ctl.playing));
    }
    clock.textContent = format(ctl.time);
    range.value = String(Math.round(((ctl.time - start) / (end - start)) * 1000));
    rel.textContent = '';
  };

  const set = (t, source = 'api') => {
    ctl.time = Math.min(end, Math.max(start, t));
    render();
    listeners.forEach((fn) => fn(ctl.time, source));
  };
  const initial = time;

  ctl.onTime = (fn) => { listeners.add(fn); fn(ctl.time, 'init'); return () => listeners.delete(fn); };
  ctl.set = set;
  ctl.follow = (t, playing) => { ctl.playing = playing; set(t, 'remote'); };
  ctl.play = (on = !ctl.playing) => { ctl.playing = on; if (ctl.time >= end && on) set(start); render(); };
  ctl.tick = (dt) => {
    if (!ctl.playing) return;
    const next = ctl.time + dt * ctl.speed * 3600 * 1000;
    if (next >= end) { set(end, 'play'); ctl.play(false); } else set(next, 'play');
  };
  ctl.setSpeed = (speed) => {
    const index = speeds.findIndex((s) => s.hoursPerSecond === speed);
    if (index >= 0) { ctl.speed = speed; speedSel.value = String(index); }
  };
  ctl.onAction = (fn) => { actionListeners.add(fn); return () => actionListeners.delete(fn); };
  ctl.node = node;

  playBtn.addEventListener('click', () => { ctl.play(); action(); });
  resetBtn.addEventListener('click', () => { ctl.play(false); set(initial, 'reset'); action(); });
  range.addEventListener('input', () => { set(start + (Number(range.value) / 1000) * (end - start), 'scrub'); action(); });
  speedSel.addEventListener('change', () => { ctl.setSpeed(speeds[Number(speedSel.value)].hoursPerSecond); action(); });
  const key = (e) => {
    if (e.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      e.preventDefault(); ctl.play(); action();
    }
  };
  window.addEventListener('keydown', key);
  ctl.dispose = () => window.removeEventListener('keydown', key);

  render();
  if (prefersReducedMotion()) ctl.playing = false;
  return ctl;
}
