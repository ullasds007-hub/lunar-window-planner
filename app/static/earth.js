
    const form = document.querySelector('#planner');
    const out = document.querySelector('#output');
    const error = document.querySelector('#error');
    const button = form.querySelector('button[type=submit]');

    const minutes = w => (Date.parse(w.end) - Date.parse(w.start)) / 60000;
    const place = () => (window.lwpPlace ? window.lwpPlace() : { name: 'Mysuru', tz: 'Asia/Kolkata' });
    const fmtFor = tz => new Intl.DateTimeFormat('en-IN', {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    const zoneLabel = tz => {
      try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName').value; }
      catch { return tz; }
    };
    const range = (w, tz) => {
      const fmt = fmtFor(tz);
      return `${fmt.format(new Date(w.start))}–${fmt.format(new Date(w.end))} ${tz === 'Asia/Kolkata' ? 'IST' : zoneLabel(tz)}`;
    };

    async function findWindows(input) {
      const response = await fetch('/windows?' + new URLSearchParams(input));
      if (!response.ok) throw new Error('The server could not complete the search.');
      return response.json();
    }

    function add(tag, value, parent = out) {
      const el = document.createElement(tag);
      el.textContent = value;
      parent.append(el);
      return el;
    }

    function renderChart(parent, windows, bestWindowId) {
      add('h3', 'Window duration · minutes', parent);
      const maxDuration = Math.max(...windows.map(minutes));

      for (const w of windows) {
        const row = add('div', '', parent);
        row.className = 'chart-row';
        const isBest = w.id === bestWindowId;
        const label = `${w.date} · ${Math.round(minutes(w))} min${isBest ? ' · Best window' : ''}`;

        add(isBest ? 'strong' : 'span', label, row);
        const bar = add('meter', '', row);
        bar.min = 0;
        bar.max = maxDuration;
        bar.value = minutes(w);
        bar.setAttribute('aria-label', label);
      }
    }

    let searchVersion = 0;
    form.addEventListener('lwp:place', () => {
      ++searchVersion;
      button.disabled = false;
      error.hidden = true;
      out.textContent = `Location set to ${place().name}. Select Find windows.`;
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const version = ++searchVersion;
      const selected = place();
      const input = Object.fromEntries(new FormData(form));
      const endDateField = form.elements.endDate;

      error.hidden = true;
      endDateField.removeAttribute('aria-invalid');

      const reversed = input.endDate < input.startDate;
      const tooLong = Date.parse(input.endDate) - Date.parse(input.startDate) >= 31 * 86400000;

      if (reversed || tooLong) {
        error.textContent = reversed
          ? 'Last observing night cannot be before the first.'
          : 'Choose up to 31 observing nights.';
        error.hidden = false;
        endDateField.setAttribute('aria-invalid', 'true');
        endDateField.focus();
        out.textContent = 'Correct the dates to run a search.';
        return;
      }

      button.disabled = true;
      out.textContent = 'Finding observation windows…';

      try {
        const response = await findWindows(input);
        if (version !== searchVersion) return;
        if (response.status !== 'ok') {
          throw new Error(response.error?.message || 'Search failed.');
        }

        const { windows, bestWindowId } = response.result;
        out.textContent = '';

        const goalLabel = input.goal === 'dark_sky' ? 'Dark sky' : 'Moon viewing';
        add('p', `${selected.name} · ${goalLabel} · ${input.startDate} to ${input.endDate}`);

        if (!windows.length) {
          add('h2', 'No windows found');
          add('p', 'Try another observing night or goal.');
          return;
        }

        const best = windows.find(w => w.id === bestWindowId);
        const summary = add('div', '');
        summary.className = 'best-window';
        add('h2', `Longest window: ${Math.round(minutes(best))} min`, summary);
        add('p', range(best, selected.tz), summary);

        add('h3', 'All qualifying windows');
        const list = add('ul', '');
        for (const w of windows) {
          const marker = w.id === bestWindowId ? ' (best)' : '';
          add('li', `${w.date} · ${range(w, selected.tz)} · ${Math.round(minutes(w))} min${marker}`, list);
        }

        renderChart(out, windows, bestWindowId);
      } catch (err) {
        if (version !== searchVersion) return;
        out.textContent = `${err.message} Select Find Windows to retry.`;
      } finally {
        if (version === searchVersion) button.disabled = false;
      }
    });
  