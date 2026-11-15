// Landing-site presets shared by the Compare and Analyze pages.
// Recommended sites: NASA Lunar Surface Data Book, Table A2.1-1 "Lunar South Pole Features"
// (coordinates from the LOLA south-pole DEM; longitude east-positive, -180..180).
window.LWP_SITES = {
  recommended: [
    ['site04', 'Shackleton Rim (Site 04)', -89.7668, -171.87],
    ['site01', 'Connecting Ridge (Site 01)', -89.4632, -137.49],
    ['sl3', 'Connecting Ridge Extension (SL3)', -89.0324, -101.999],
    ['site07', 'Peak Near Shackleton (Site 07)', -88.811, 123.6901],
    ['site11', 'de Gerlache Rim 1 (Site 11)', -88.6834, -67.9321],
    ['sl2', 'de Gerlache Rim 2 (SL2)', -88.23, -64.6284],
    ['haworth', 'Haworth', -86.7639, -22.777],
    ['site23', 'Malapert Massif (Site 23)', -85.9948, -0.23578],
    ['site42', 'de Gerlache–Kocher Massif (Site 42)', -85.8296, -116.322],
    ['site06', 'Nobile Rim 1 (Site 06)', -85.4381, 37.36667],
    ['site20', 'Leibnitz Beta Plateau (Site 20)', -85.4266, 31.74276],
    ['dm2', 'Nobile Rim 2 (DM2)', -83.954, 58.82206],
  ],
  historical: [
    ['im1', 'Odysseus (IM-1) — historical landing site', -80.13, 1.44],
    ['im2', 'Athena (IM-2) — historical landing site', -84.7906, 29.1957],
  ],
};
window.LWP_SITES.byId = Object.fromEntries(
  [...window.LWP_SITES.recommended, ...window.LWP_SITES.historical].map(([id, , lat, lon]) => [id, [lat, lon]]));
window.LWP_SITES.optionsHtml = () => {
  const opt = ([id, name]) => `<option value="${id}">${name}</option>`;
  return '<option value="">Custom coordinates</option>' +
    `<optgroup label="NASA Lunar Surface Data Book — candidate sites">${window.LWP_SITES.recommended.map(opt).join('')}</optgroup>` +
    `<optgroup label="Historical landings">${window.LWP_SITES.historical.map(opt).join('')}</optgroup>`;
};

// Any <select data-lwp-sites> fills the lat/lon inputs of its form
document.querySelectorAll('select[data-lwp-sites]').forEach((select) => {
  const form = select.form;
  const lat = form.querySelector('[name=lat]'), lon = form.querySelector('[name=lon]');
  select.innerHTML = window.LWP_SITES.optionsHtml();
  select.addEventListener('change', () => { if (select.value) [lat.value, lon.value] = window.LWP_SITES.byId[select.value]; });
  for (const input of [lat, lon]) input.addEventListener('input', () => { select.value = ''; });
});
