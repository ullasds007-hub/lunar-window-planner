import { el, fmtUTC } from '../util.js';
import { prefersReducedMotion } from '../state.js';

/**
 * Shared time control: Play/Pause, Reset, a scrubber over [start, end] and a speed selector.
 * Owns the authoritative time for the views it drives; views read it through onTime callbacks.
 */
export function createTimeControl({ start, end, time, speeds, speedIndex = 1, format = fmtUTC, label = 'Scenario time' }) {
  const listeners = new Set();
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

  const render = () => {
    playBtn.innerHTML = icon(ctl.playing);
    playBtn.setAttribute('aria-label', ctl.playing ? 'Pause' : 'Play');
    playBtn.setAttribute('aria-pressed', String(ctl.playing));
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
  ctl.play = (on = !ctl.playing) => { ctl.playing = on; if (ctl.time >= end && on) set(start); render(); };
  ctl.tick = (dt) => {
    if (!ctl.playing) return;
    const next = ctl.time + dt * ctl.speed * 3600 * 1000;
    if (next >= end) { set(end, 'play'); ctl.play(false); } else set(next, 'play');
  };
  ctl.node = node;

  playBtn.addEventListener('click', () => ctl.play());
  resetBtn.addEventListener('click', () => { ctl.play(false); set(initial, 'reset'); });
  range.addEventListener('input', () => set(start + (Number(range.value) / 1000) * (end - start), 'scrub'));
  speedSel.addEventListener('change', () => { ctl.speed = speeds[Number(speedSel.value)].hoursPerSecond; });
  const key = (e) => {
    if (e.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      e.preventDefault(); ctl.play();
    }
  };
  window.addEventListener('keydown', key);
  ctl.dispose = () => window.removeEventListener('keydown', key);

  render();
  if (prefersReducedMotion()) ctl.playing = false;
  return ctl;
}
