(() => {
  const key = 'lwp-atlas-theme';
  const root = document.documentElement;
  const valid = value => value === 'light' || value === 'dark';
  let toggle;
  function apply(value) {
    root.dataset.theme = valid(value) ? value : 'light';
    if (toggle) {
      const dark = root.dataset.theme === 'dark';
      toggle.textContent = dark ? 'Theme: Dark' : 'Theme: Light';
      toggle.setAttribute('aria-label', dark ? 'Theme: Dark. Switch to light mode.' : 'Theme: Light. Switch to dark mode.');
    }
  }
  function restore() {
    try { apply(localStorage.getItem(key) || root.dataset.theme); }
    catch { apply(root.dataset.theme); }
  }
  restore();
  document.addEventListener('DOMContentLoaded', () => {
    toggle = document.querySelector('#theme-toggle');
    if (!toggle) return;
    restore();
    toggle.hidden = false;
    toggle.addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem(key, next); } catch {}
    });
  });
  window.addEventListener('pageshow', restore);
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();