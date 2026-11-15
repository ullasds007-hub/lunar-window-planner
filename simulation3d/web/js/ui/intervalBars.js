import { el } from '../util.js';

const ROWS = [
  { label: 'Sunlight', color: 'var(--c-sun)' },
  { label: 'Darkness', color: 'var(--c-dark)' },
  { label: 'Earth in view', color: 'var(--c-earth)' },
  { label: 'Sunlight + Earth', color: 'var(--c-both)' },
];

/** Four interval tracks (the planner's timeline) with a moving time cursor. */
export function createIntervalBars({ title = 'Calculated timeline' } = {}) {
  const head = el('div', { class: 'ib-head' }, el('span', { class: 'eyebrow' }, title));
  const src = el('div', { class: 'ib-src small muted' });
  const body = el('div', { class: 'ib-body' });
  const cursor = el('div', { class: 'ib-cursor', 'aria-hidden': 'true' });
  const tracks = el('div', { class: 'ib-tracks' }, body, cursor);
  const node = el('div', { class: 'ib' }, head, tracks, src);
  let range = [0, 1];

  return {
    node,
    set(rows, start, end, source) {
      range = [start, end];
      const span = end - start;
      body.replaceChildren(...ROWS.map((r, i) => {
        const total = (rows[i] || []).reduce((s, [a, b]) => s + (b - a), 0) / 3600e3;
        const track = el('div', { class: 'ib-track', role: 'img', 'aria-label': `${r.label}: ${total.toFixed(1)} hours` },
          ...(rows[i] || []).map(([a, b]) => el('span', {
            style: `left:${(100 * (a - start)) / span}%;width:${Math.max(0.15, (100 * (b - a)) / span)}%;background:${r.color}`,
          })));
        return el('div', { class: 'ib-row' }, el('span', { class: 'ib-label' }, r.label), track, el('span', { class: 'ib-total mono' }, `${total.toFixed(1)} h`));
      }));
      src.textContent = source ? `Source: ${source}` : '';
    },
    setError(msg) { body.replaceChildren(el('p', { class: 'small muted' }, msg)); src.textContent = ''; },
    cursor(t) {
      const f = (t - range[0]) / (range[1] - range[0]);
      cursor.style.left = `calc(var(--ib-label-w) + (100% - var(--ib-label-w) - var(--ib-total-w)) * ${Math.min(1, Math.max(0, f))})`;
    },
  };
}
