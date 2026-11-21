/* ==========================================================================
   NEXUS — app.js
   index.html and style.css do the structure, tabs and detail screens.
   This file has four small jobs:

     1. LISTS     – the saved lists: create, save a title, build the My List boxes
     2. SEARCH    – hide the Search rows that don't match what was typed
     3. HISTORY   – remember what was searched and list it on the Search tab
     4. CALENDAR  – draw the day cells of the Stats calendar

   Poster artwork is never repeated here: it is copied from the Search rows
   in index.html (each row has the poster for one title).
   ========================================================================== */
'use strict';

const $ = id => document.getElementById(id);
const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Read / write JSON in localStorage (never crash if storage is blocked). */
function readJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : fallback;
  } catch (err) { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* ignore */ }
}

/* The Search row of a title: holds its poster, name and details. */
const rowOf = id => document.querySelector(`#search-results .row[data-id="${id}"]`);

/* ==========================================================================
   1. LISTS
   lists = [ { id, name, items: [titleId, ...] }, ... ]
   A title counts as "saved" when it is in at least one list.
   ========================================================================== */

const LISTS_KEY = 'nexus_lists_v5';
const STARTER_LISTS = [{ id: 'favorites', name: 'Favorites', items: ['interstellar', 'darkknight', 'dune', 'jjk', 'rdr2', 'ghost'] }];

let lists = readJSON(LISTS_KEY, null);
if (!lists || !lists.length) lists = JSON.parse(JSON.stringify(STARTER_LISTS));

let openListId = null;                // the list shown full-screen, if any
let pendingId = null;                 // the title being saved while the picker is open

const isSaved = id => lists.some(list => list.items.includes(id));

/* Redraw everything that depends on the lists. */
function refresh() {
  writeJSON(LISTS_KEY, lists);
  document.querySelectorAll('[data-save]').forEach(el => el.classList.toggle('saved', isSaved(el.dataset.save)));
  renderLists();
  renderListView();
  if (!$('save-sheet').hidden) renderSaveSheet();
}

/* ---- My List tab: one box per list ---- */

function tileFor(id) {
  const poster = rowOf(id).querySelector('.art');
  const tile = document.createElement('a');
  tile.className = 'tile art';
  tile.href = '#' + id;
  tile.setAttribute('style', poster.getAttribute('style'));
  tile.setAttribute('aria-label', poster.getAttribute('aria-label'));
  tile.innerHTML = poster.innerHTML;
  return tile;
}

function renderLists() {
  $('lists').replaceChildren(...lists.map(list => {
    const box = $('tpl-vault').content.firstElementChild.cloneNode(true);
    box.querySelector('.name').textContent = list.name;
    box.querySelector('.count').textContent = list.items.length + ' saved';

    // Up to 4 titles: show them all. More than 4: three posters, then a "+N" box.
    const many = list.items.length > 4;
    const nodes = list.items.slice(0, many ? 3 : 4).map(tileFor);
    if (many) {
      const more = document.createElement('button');
      more.className = 'more-tile';
      more.dataset.openList = list.id;
      more.setAttribute('aria-label', `Show all ${list.items.length} titles`);
      more.innerHTML = `<strong>+${list.items.length - 3}</strong><small>more</small>`;
      nodes.push(more);
    }
    box.querySelector('.vault-grid').replaceChildren(...nodes);
    return box;
  }));
}

/* ---- Full-screen list: every title of one list, no container ---- */

function renderListView() {
  const view = $('list-view');
  const list = lists.find(l => l.id === openListId);
  view.hidden = !list;
  if (!list) { openListId = null; return; }
  $('list-view-title').textContent = list.name;
  $('list-view-count').textContent = list.items.length + ' saved';
  $('list-view-grid').replaceChildren(...list.items.map(tileFor));
}

$('lists').addEventListener('click', event => {
  const more = event.target.closest('[data-open-list]');
  if (!more) return;
  openListId = more.dataset.openList;
  renderListView();
  $('list-view').scrollTop = 0;
});
$('list-view-back').addEventListener('click', () => { openListId = null; renderListView(); });

/* ---- Saving a title ---- */

function toggleInList(list, id) {
  list.items = list.items.includes(id) ? list.items.filter(x => x !== id) : [...list.items, id];
}

/* Any button with data-save="title-id": one list → toggle it; several → ask which. */
document.addEventListener('click', event => {
  const button = event.target.closest('[data-save]');
  if (!button) return;
  const id = button.dataset.save;
  if (lists.length === 1) { toggleInList(lists[0], id); refresh(); return; }
  pendingId = id;
  renderSaveSheet();
  $('save-sheet').hidden = false;
});

/* ---- "Save to..." picker ---- */

function renderSaveSheet() {
  $('save-sheet-sub').textContent = rowOf(pendingId).querySelector('h3').textContent;
  $('save-sheet-options').innerHTML = lists.map(list =>
    `<button class="sheet-option ${list.items.includes(pendingId) ? 'on' : ''}" data-pick="${list.id}">${esc(list.name)}<small>${list.items.length}</small></button>`
  ).join('');
}

function closeSaveSheet() { $('save-sheet').hidden = true; pendingId = null; }

$('save-sheet-options').addEventListener('click', event => {
  const option = event.target.closest('[data-pick]');
  if (!option) return;
  toggleInList(lists.find(list => list.id === option.dataset.pick), pendingId);
  refresh();
});
$('save-sheet-done').addEventListener('click', closeSaveSheet);
$('save-sheet').addEventListener('click', event => { if (event.target === event.currentTarget) closeSaveSheet(); });
$('save-sheet-new').addEventListener('click', openNewList);

/* ---- "New list" form ---- */

function openNewList() {
  $('new-list').hidden = false;
  $('new-list-name').focus();
}
function closeNewList() {
  $('new-list').hidden = true;
  $('new-list-name').value = '';
}

$('new-list-btn').addEventListener('click', () => { pendingId = null; openNewList(); });
$('new-list-cancel').addEventListener('click', closeNewList);
$('new-list').addEventListener('click', event => { if (event.target === event.currentTarget) closeNewList(); });
$('new-list-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('new-list-name').value.trim();
  if (!name) return;
  lists.push({ id: 'l' + Date.now(), name, items: pendingId ? [pendingId] : [] });   // add the title being saved, if any
  closeNewList();
  refresh();
});

/* ==========================================================================
   2. SEARCH
   Each row has data-search="title genre year type" (lower case).
   Nothing typed → the history shows. Something typed → matching rows show.
   ========================================================================== */

const input = $('search-input');
const rows = [...document.querySelectorAll('#search-results .row')];

function filterRows() {
  const text = input.value.trim().toLowerCase();
  let matches = 0;
  rows.forEach(row => {
    const hit = Boolean(text) && row.dataset.search.includes(text);
    row.hidden = !hit;
    if (hit) matches++;
  });
  $('history').hidden = Boolean(text);
  $('search-clear').hidden = !text;
  $('search-empty').hidden = !text || matches > 0;
  $('search-heading').hidden = !text || matches === 0;
  $('search-heading').textContent = `${matches} ${matches === 1 ? 'result' : 'results'} for “${input.value.trim()}”`;
}

input.addEventListener('input', filterRows);
$('search-clear').addEventListener('click', () => { input.value = ''; filterRows(); input.focus(); });

/* ==========================================================================
   3. HISTORY
   A search is remembered when Enter is pressed or when a result is opened.
   ========================================================================== */

const HISTORY_KEY = 'nexus_history_v5';
const HISTORY_MAX = 8;
const CLOCK = '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const CROSS = '<svg class="icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
let searchHistory = readJSON(HISTORY_KEY, []);

function renderHistory() {
  $('history-list').innerHTML = searchHistory.map(text => `
    <li class="history-item">
      <button class="history-query" data-query="${esc(text)}">${CLOCK}<span>${esc(text)}</span></button>
      <button class="history-remove" data-remove="${esc(text)}" aria-label="Remove ${esc(text)} from history">${CROSS}</button>
    </li>`).join('');
  $('history-empty').hidden = searchHistory.length > 0;
  $('history-clear').hidden = searchHistory.length === 0;
}

function remember(text) {
  text = text.trim();
  if (!text) return;
  searchHistory = [text, ...searchHistory.filter(h => h.toLowerCase() !== text.toLowerCase())].slice(0, HISTORY_MAX);
  writeJSON(HISTORY_KEY, searchHistory);
  renderHistory();
}

$('search-form').addEventListener('submit', event => { event.preventDefault(); remember(input.value); input.blur(); });
$('search-results').addEventListener('click', event => { if (event.target.closest('a')) remember(input.value); });

$('history-list').addEventListener('click', event => {
  const query = event.target.closest('[data-query]');
  const remove = event.target.closest('[data-remove]');
  if (query) { input.value = query.dataset.query; filterRows(); input.focus(); }
  if (remove) {
    searchHistory = searchHistory.filter(h => h !== remove.dataset.remove);
    writeJSON(HISTORY_KEY, searchHistory);
    renderHistory();
  }
});
$('history-clear').addEventListener('click', () => { searchHistory = []; writeJSON(HISTORY_KEY, searchHistory); renderHistory(); });

/* ==========================================================================
   4. CALENDAR (Stats)
   WATCH_LOG is sample data: one entry per title watched on a day.
   Replace it with real history later.
   ========================================================================== */

const WATCH_LOG = [
  { date: '2026-11-02', id: 'interstellar' }, { date: '2026-11-05', id: 'breakingbad' }, { date: '2026-11-05', id: 'aot' },
  { date: '2026-11-09', id: 'dune' },         { date: '2026-11-12', id: 'jjk' },         { date: '2026-11-14', id: 'ghost' },
  { date: '2026-11-17', id: 'dark' },         { date: '2026-11-19', id: 'deathnote' },  { date: '2026-11-20', id: 'darkknight' },
  { date: '2026-11-21', id: 'rdr2' },
  { date: '2026-10-03', id: 'inception' },    { date: '2026-10-08', id: 'stranger' },    { date: '2026-10-15', id: 'boys' },
  { date: '2026-10-22', id: 'kimetsu' },      { date: '2026-10-28', id: 'cp77' },
];

const now = new Date();
const dateKey = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const todayKey = dateKey(now.getFullYear(), now.getMonth(), now.getDate());
const calendar = { year: now.getFullYear(), month: now.getMonth(), selected: todayKey };

function renderCalendar() {
  const { year, month, selected } = calendar;
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prefix = dateKey(year, month, 1).slice(0, 7);
  const count = WATCH_LOG.filter(e => e.date.startsWith(prefix)).length;

  $('cal-month').textContent = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  $('cal-summary').textContent = `${count} ${count === 1 ? 'title' : 'titles'} watched this month`;

  // Blank cells push day 1 under the right weekday (weeks start on Sunday).
  let cells = '<div class="day blank"></div>'.repeat(firstDay.getDay());
  for (let day = 1; day <= daysInMonth; day++) {
    const key = dateKey(year, month, day);
    const watched = WATCH_LOG.filter(e => e.date === key);
    const poster = watched.length ? rowOf(watched[0].id).querySelector('.art') : null;
    const classes = ['day', poster && 'art', key === todayKey && 'today', key === selected && 'selected'].filter(Boolean).join(' ');
    cells += `<button class="${classes}" data-date="${key}" ${poster ? `style="${poster.getAttribute('style')}"` : ''} aria-label="${key}">
      ${poster ? poster.innerHTML : ''}<span class="day-num">${day}</span></button>`;
  }
  $('cal-grid').innerHTML = cells;

  // Under the calendar: what was watched on the selected day.
  const picked = selected ? WATCH_LOG.filter(e => e.date === selected) : [];
  $('day-list').replaceChildren(...picked.map(entry => {
    const row = rowOf(entry.id).cloneNode(true);
    row.hidden = false;
    row.querySelector('.plus').remove();                     // no save button in this list
    return row;
  }));
  $('day-heading').hidden = !selected;
  if (selected) {
    $('day-heading').textContent = new Date(selected + 'T00:00:00')
      .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  $('day-note').hidden = picked.length > 0;
  $('day-note').textContent = selected ? 'Nothing logged on this day.' : 'Tap a day to see what you watched.';
}

function changeMonth(step) {
  const next = new Date(calendar.year, calendar.month + step, 1);
  calendar.year = next.getFullYear();
  calendar.month = next.getMonth();
  calendar.selected = null;
  renderCalendar();
}

$('cal-prev').addEventListener('click', () => changeMonth(-1));
$('cal-next').addEventListener('click', () => changeMonth(1));
$('cal-grid').addEventListener('click', event => {
  const day = event.target.closest('.day[data-date]');
  if (!day) return;
  calendar.selected = calendar.selected === day.dataset.date ? null : day.dataset.date;
  renderCalendar();
});

/* ---------- Start ---------- */
refresh();
filterRows();
renderHistory();
renderCalendar();
