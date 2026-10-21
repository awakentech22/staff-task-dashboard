(() => {
  'use strict';

  const TZ = 'America/Los_Angeles';
  const AUTO_REFRESH_MS = 5 * 60 * 1000;
  const STALE_AFTER_MS = 2 * 60 * 1000;

  const peopleEl = document.getElementById('people');
  const messageEl = document.getElementById('message');
  const boardEl = document.getElementById('board');
  const updatedEl = document.getElementById('updated');
  const refreshBtn = document.getElementById('refresh');
  const showDoneEl = document.getElementById('show-done');

  const STORAGE_KEY = 'staffTasks.selection.v1';
  const MAX_PEOPLE = 8;

  let data = null;
  let loadedAt = 0;
  let loading = false;

  /* ---------- Saved selection (this browser only) ---------- */

  // null means "show the default list"; an array (possibly empty) is the viewer's own choice.
  function readSelection() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return null;
      return list
        .filter((p) => p && typeof p.key === 'string' && typeof p.name === 'string')
        .slice(0, MAX_PEOPLE)
        .map((p) => ({ key: p.key, name: p.name, email: typeof p.email === 'string' ? p.email : null }));
    } catch (err) {
      return null;
    }
  }

  function writeSelection(list) {
    try {
      if (list) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      /* Storage can be blocked; the choice then lasts until the page closes. */
    }
  }

  let selection = readSelection();

  /* ---------- DOM helper (text only, never innerHTML) ---------- */

  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else node.setAttribute(key, value);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.append(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
    }
    return node;
  }

  /* ---------- Dates (calendar days in Pacific time) ---------- */

  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });

  function dayInTz(date) {
    return dayFormatter.format(date); // YYYY-MM-DD
  }

  // Planner due dates are stored as timestamps. Some clients save a date as UTC
  // midnight; treat those as plain calendar dates, otherwise convert to Pacific.
  function dueDay(iso) {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    const atUtcMidnight = date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0;
    return atUtcMidnight ? iso.slice(0, 10) : dayInTz(date);
  }

  function dayNumber(day) {
    const [y, m, d] = day.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  }

  function diffDays(from, to) {
    return dayNumber(to) - dayNumber(from);
  }

  function shortDate(day, today) {
    const [y, m, d] = day.split('-').map(Number);
    const sameYear = day.slice(0, 4) === today.slice(0, 4);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
    }).format(new Date(Date.UTC(y, m - 1, d)));
  }

  function relativeLabel(diff) {
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return '1 day late';
    return diff < 0 ? `${-diff} days late` : `In ${diff} days`;
  }

  function clockTime(ms) {
    return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true })
      .format(new Date(ms))
      .replace(/\s?(AM|PM)$/i, (m) => m.trim().toLowerCase());
  }

  /* ---------- Grouping ---------- */

  const GROUPS = [
    { key: 'overdue', label: 'Overdue' },
    { key: 'week', label: 'Due in the next 7 days' },
    { key: 'later', label: 'Later' },
    { key: 'none', label: 'No due date' },
    { key: 'done', label: 'Recently completed' },
  ];

  function classify(task, today) {
    if (task.status === 'completed') return 'done';
    const day = dueDay(task.dueDateTime);
    if (!day) return 'none';
    const diff = diffDays(today, day);
    if (diff < 0) return 'overdue';
    return diff <= 7 ? 'week' : 'later';
  }

  function compareTasks(a, b) {
    if (a.status === 'completed' && b.status === 'completed') {
      return Date.parse(b.completedDateTime || 0) - Date.parse(a.completedDateTime || 0);
    }
    const dayA = dueDay(a.dueDateTime);
    const dayB = dueDay(b.dueDateTime);
    if (dayA && dayB && dayA !== dayB) return dayA < dayB ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.title.localeCompare(b.title);
  }

  /* ---------- Rendering ---------- */

  const PERSON_ERRORS = {
    USER_NOT_FOUND: (p) => `Microsoft 365 doesn’t recognize ${p.email || p.key}. If this is on the default list, check the email in api/staff.json.`,
    FORBIDDEN: () => 'The dashboard app isn’t allowed to read Planner tasks yet. A Microsoft 365 admin needs to grant consent.',
    CONFIG: (p) => `${p.error.message}. Add them in the Static Web App’s environment variables.`,
    AUTH: (p) => `Microsoft rejected the dashboard app’s sign-in (${p.error.message}). The client secret may have expired.`,
    UNKNOWN: () => 'We couldn’t load these tasks. Try refreshing in a minute.',
  };

  function renderTask(task, today) {
    const day = dueDay(task.dueDateTime);
    const isOpen = task.status !== 'completed';
    const diff = day ? diffDays(today, day) : null;
    const overdue = isOpen && diff !== null && diff < 0;

    const steps = task.checklistItemCount > 0
      ? `${task.checklistItemCount - task.activeChecklistItemCount} of ${task.checklistItemCount} steps done`
      : null;
    const progress = task.status === 'inProgress' ? `${task.percentComplete}% done` : null;

    return h('li', { class: `task${overdue ? ' is-overdue' : ''}${isOpen ? '' : ' is-done'}` },
      h('div', { class: 'main' },
        h('p', { class: 'title' }, task.title),
        (task.planTitle || task.bucketTitle) && h('p', { class: 'where' },
          task.planTitle && h('span', { class: 'plan' }, task.planTitle),
          task.bucketTitle && h('span', { class: 'bucket' }, task.bucketTitle))),
      h('div', { class: 'side' },
        day && h('span', { class: 'due' }, shortDate(day, today)),
        day && isOpen && h('span', { class: 'rel' }, relativeLabel(diff)),
        isOpen && (task.priorityLabel === 'Urgent' || task.priorityLabel === 'Important') &&
          h('span', { class: `flag flag-${task.priorityLabel.toLowerCase()}` }, task.priorityLabel),
        isOpen && progress && h('span', { class: 'progress' }, progress),
        isOpen && steps && h('span', { class: 'progress' }, steps)));
  }

  function renderPerson(person, today, showDone) {
    const all = person.tasks || [];
    const open = all.filter((t) => t.status !== 'completed');
    const done = all.filter((t) => t.status === 'completed');

    const buckets = { overdue: [], week: [], later: [], none: [], done: [] };
    for (const task of open) buckets[classify(task, today)].push(task);
    if (showDone) buckets.done = done;
    for (const list of Object.values(buckets)) list.sort(compareTasks);

    const head = h('div', { class: 'person-head' },
      h('h2', null, person.name),
      h('p', { class: 'count' }, person.error ? 'Couldn’t load' : `${open.length} open`));

    if (!person.error && open.length > 0) {
      const counts = [
        ['overdue', buckets.overdue.length, 'overdue'],
        ['week', buckets.week.length, 'due this week'],
        ['later', buckets.later.length, 'later'],
        ['none', buckets.none.length, 'no due date'],
      ].filter(([, n]) => n > 0);

      const bar = h('div', { class: 'load', role: 'img',
        'aria-label': `${open.length} open: ${counts.map(([, n, label]) => `${n} ${label}`).join(', ')}` });
      for (const [key, n] of counts) {
        const seg = h('span', { class: `seg seg-${key}` });
        seg.style.flexGrow = String(n);
        bar.append(seg);
      }
      head.append(bar, h('ul', { class: 'legend' },
        counts.map(([key, n, label]) => h('li', null, h('span', { class: `swatch swatch-${key}`, 'aria-hidden': 'true' }), `${n} ${label}`))));
    }

    const body = [];
    if (person.error) {
      const describe = PERSON_ERRORS[person.error.code] || PERSON_ERRORS.UNKNOWN;
      body.push(h('div', { class: 'notice', role: 'alert' }, h('strong', null, 'Tasks unavailable'), describe(person)));
    } else if (open.length === 0 && !(showDone && done.length)) {
      body.push(h('p', { class: 'empty' }, 'Nothing open right now.'));
    } else {
      for (const { key, label } of GROUPS) {
        const list = buckets[key];
        if (!list.length) continue;
        body.push(h('section', { class: `group group-${key}` },
          h('h3', null, h('span', null, label), h('span', null, String(list.length))),
          h('ul', { class: 'tasks' }, list.map((task) => renderTask(task, today)))));
      }
    }

    return h('section', { class: 'person', 'aria-label': person.name }, head, body);
  }

  function render() {
    if (!data) return;
    const today = dayInTz(new Date());
    const showDone = showDoneEl.checked;
    if (data.people.length === 0) {
      peopleEl.replaceChildren(h('p', { class: 'empty' }, 'No one is selected. Use Choose people to add someone.'));
    } else {
      peopleEl.replaceChildren(...data.people.map((person) => renderPerson(person, today, showDone)));
    }
    updatedEl.textContent = `Updated ${clockTime(loadedAt)}`;
  }

  /* ---------- Loading ---------- */

  function setMessage(text, isError) {
    messageEl.textContent = text || '';
    messageEl.classList.toggle('is-error', Boolean(isError));
  }

  // Returns true when the saved list was rejected and a retry with the default list is needed.
  async function loadOnce() {
    if (loading) return false;
    loading = true;
    refreshBtn.disabled = true;
    boardEl.setAttribute('aria-busy', 'true');
    if (!data) setMessage('Loading tasks…');

    try {
      if (Array.isArray(selection) && selection.length === 0) {
        data = { people: [] };
        loadedAt = Date.now();
        setMessage('');
        render();
        return false;
      }

      const request = Array.isArray(selection)
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ people: selection.map(({ key, name }) => ({ key, name })) }),
          }
        : { headers: { Accept: 'application/json' } };
      const response = await fetch('/api/tasks', { ...request, cache: 'no-store', credentials: 'same-origin' });

      if (response.status === 401) { window.location.assign('/login'); return false; }
      if (response.status === 403) {
        const body = await response.json().catch(() => ({}));
        data = null;
        peopleEl.replaceChildren();
        updatedEl.textContent = '';
        setMessage(
          body.signedInAs
            ? `You’re signed in as ${body.signedInAs}, but that account isn’t on the viewer list. Ask the person who manages this dashboard to add it.`
            : 'This account isn’t on the viewer list. Ask the person who manages this dashboard to add it.',
          true
        );
        return false;
      }
      if (response.status === 400 && Array.isArray(selection)) {
        selection = null;
        writeSelection(null);
        return true;
      }
      if (!response.ok) throw new Error(`Request failed (${response.status})`);

      data = await response.json();
      loadedAt = Date.now();
      setMessage('');
      render();
    } catch (err) {
      if (data) {
        setMessage(`Couldn’t refresh. Showing tasks from ${clockTime(loadedAt)}.`, true);
      } else {
        setMessage('We couldn’t load the tasks. Check your connection and press Refresh.', true);
      }
    } finally {
      loading = false;
      refreshBtn.disabled = false;
      boardEl.removeAttribute('aria-busy');
    }
    return false;
  }

  async function load() {
    if (await loadOnce()) await loadOnce();
  }

  /* ---------- People picker ---------- */

  const pickerEl = document.getElementById('picker');
  const chooseBtn = document.getElementById('choose');
  const doneBtn = document.getElementById('picker-done');
  const resetBtn = document.getElementById('picker-reset');
  const queryEl = document.getElementById('picker-query');
  const pickerStatusEl = document.getElementById('picker-status');
  const resultsEl = document.getElementById('picker-results');
  const chosenEl = document.getElementById('picker-chosen');

  let working = [];
  let results = [];
  let dirty = false;
  let searchTimer = 0;
  let searchSeq = 0;

  function setPickerStatus(text) {
    pickerStatusEl.textContent = text || '';
  }

  function limitMessage() {
    return `You can show up to ${MAX_PEOPLE} people. Remove someone to add another.`;
  }

  function isChosen(person) {
    const email = (person.email || '').toLowerCase();
    return working.some((p) => p.key.toLowerCase() === person.key.toLowerCase() || (email && (p.email || '').toLowerCase() === email));
  }

  function personRow(person, label, onClick, disabled) {
    const button = h('button', {
      type: 'button',
      class: 'btn btn-small',
      'aria-label': `${label} ${person.name}`,
      disabled: disabled ? 'disabled' : null,
    }, label);
    button.addEventListener('click', onClick);
    return h('li', { class: 'picker-row' },
      h('div', null,
        h('p', { class: 'picker-name' }, person.name),
        person.title && h('p', { class: 'picker-sub' }, person.title),
        person.email && h('p', { class: 'picker-sub' }, person.email)),
      button);
  }

  function renderPicker() {
    const full = working.length >= MAX_PEOPLE;

    const visible = results.filter((person) => !isChosen(person));
    resultsEl.replaceChildren(...visible.map((person) =>
      personRow(person, 'Add', () => {
        if (working.length >= MAX_PEOPLE) return;
        working.push({ key: person.key, name: person.name, email: person.email || null });
        dirty = true;
        setPickerStatus(`${person.name} added.`);
        renderPicker();
      }, full)));

    if (full) setPickerStatus(limitMessage());

    if (working.length === 0) {
      chosenEl.replaceChildren(h('li', { class: 'picker-empty' }, 'No one yet. Search above to add someone.'));
    } else {
      chosenEl.replaceChildren(...working.map((person, index) =>
        personRow(person, 'Remove', () => {
          working.splice(index, 1);
          dirty = true;
          setPickerStatus(`${person.name} removed.`);
          renderPicker();
        })));
    }
  }

  function openPicker() {
    const source = Array.isArray(selection) ? selection : (data ? data.people : []);
    working = source.map((p) => ({ key: p.key, name: p.name, email: p.email || null }));
    results = [];
    dirty = false;
    queryEl.value = '';
    setPickerStatus('');
    renderPicker();
    pickerEl.showModal();
    queryEl.focus();
  }

  async function runSearch(term) {
    const seq = (searchSeq += 1);
    setPickerStatus('Searching…');
    try {
      const response = await fetch(`/api/people?q=${encodeURIComponent(term)}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (seq !== searchSeq) return;
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        results = [];
        renderPicker();
        setPickerStatus(
          body.error === 'GRAPH_FORBIDDEN'
            ? 'The dashboard app needs permission to search people. A Microsoft 365 admin must grant User.Read.All.'
            : 'Search isn’t working right now. Try again in a minute.'
        );
        return;
      }
      const body = await response.json();
      results = Array.isArray(body.results) ? body.results : [];
      renderPicker();
      setPickerStatus(working.length >= MAX_PEOPLE ? limitMessage() : (results.length ? '' : 'No one found.'));
    } catch (err) {
      if (seq !== searchSeq) return;
      results = [];
      renderPicker();
      setPickerStatus('Search isn’t working right now. Try again in a minute.');
    }
  }

  chooseBtn.addEventListener('click', openPicker);
  doneBtn.addEventListener('click', () => pickerEl.close());

  queryEl.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchSeq += 1;
    const term = queryEl.value.trim();
    if (term.length < 2) {
      results = [];
      setPickerStatus('');
      renderPicker();
      return;
    }
    searchTimer = window.setTimeout(() => runSearch(term), 250);
  });

  resetBtn.addEventListener('click', () => {
    selection = null;
    writeSelection(null);
    dirty = false;
    pickerEl.close();
    load();
  });

  pickerEl.addEventListener('close', () => {
    window.clearTimeout(searchTimer);
    if (!dirty) return;
    dirty = false;
    selection = working.map((p) => ({ key: p.key, name: p.name, email: p.email }));
    writeSelection(selection);
    load();
  });

  refreshBtn.addEventListener('click', load);
  showDoneEl.addEventListener('change', render);

  setInterval(() => {
    if (document.visibilityState === 'visible') load();
  }, AUTO_REFRESH_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - loadedAt > STALE_AFTER_MS) load();
  });

  load();
})();
