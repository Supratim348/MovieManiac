/* ==========================================================================
   NEXUS — app.js
   index.html + style.css hold the structure, tabs and styling. This file:

     1. SETUP      – settings, Supabase client, small helpers
     2. TITLES     – TMDB (movies, series, anime) and RAWG (games) lookups
     3. SIGN IN    – Supabase email + password login
     4. DATA       – lists, list items and the watch log in Supabase
     5. SCREENS    – draw Home, Search, Stats, My List and the detail page
     6. EVENTS     – clicks and typing
     7. START      – boot when a user is signed in

   An "item" is one title in a single shape, whatever API it came from:
   { key, id, media, kind, title, year, rating, poster, overview }
     key   "movie:603"            unique id used in the page
     media "movie" | "tv" | "game"  which API route the id belongs to
     kind  "movie" | "series" | "anime" | "game"  the label shown to the user
   ========================================================================== */
'use strict';

/* ==========================================================================
   1. SETUP
   ========================================================================== */

const CFG = window.NEXUS_CONFIG || {};
const sb = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY)
  : null;

const IMG = 'https://image.tmdb.org/t/p/w500';
const KIND_LABEL = { movie: 'Movie', series: 'Series', anime: 'Anime', game: 'Game' };

const $ = id => document.getElementById(id);
const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Every item we draw is remembered here so a click on data-open="key" can find it. */
const cache = new Map();
const remember = item => { cache.set(item.key, item); return item; };

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2200);
}

const dateKey = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const now = new Date();
const todayKey = dateKey(now.getFullYear(), now.getMonth(), now.getDate());

/* Posters: the real image, with a coloured gradient + title behind it.
   The gradient colour comes from the item key; if the image fails it shows through. */
function hueOf(key) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
const artStyle = item => `--a:${hueOf(item.key)};--b:${(hueOf(item.key) + 70) % 360}`;
const posterHTML = item =>
  (item.poster ? `<img src="${esc(item.poster)}" alt="" loading="lazy" onerror="this.remove()">` : '') + `<b>${esc(item.title)}</b>`;
const metaLine = item => [item.year, KIND_LABEL[item.kind], item.rating ? '★ ' + item.rating : ''].filter(Boolean).join(' · ');

/* The columns saved to Supabase for a title. */
const snapshot = item => ({
  item_id: item.id, media_type: item.media, kind: item.kind, title: item.title,
  poster: item.poster || null, year: Number(item.year) || null, rating: item.rating || null,
});
/* ...and back again. */
const fromRow = r => ({
  key: `${r.media_type}:${r.item_id}`, id: r.item_id, media: r.media_type, kind: r.kind, title: r.title,
  year: r.year || '', rating: r.rating ? Number(r.rating) : null, poster: r.poster || '', overview: '',
});

/* ==========================================================================
   2. TITLES  (TMDB + RAWG)
   ========================================================================== */

async function tmdb(path) {
  const res = await fetch('https://api.themoviedb.org/3' + path, {
    headers: { Authorization: 'Bearer ' + CFG.TMDB_TOKEN, accept: 'application/json' },
  });
  if (!res.ok) throw new Error('TMDB error ' + res.status);
  return res.json();
}

async function rawg(path) {
  const res = await fetch(`https://api.rawg.io/api${path}${path.includes('?') ? '&' : '?'}key=${CFG.RAWG_KEY}`);
  if (!res.ok) throw new Error('RAWG error ' + res.status);
  return res.json();
}

/* TMDB result → item. Anime = Animation genre (id 16) + Japanese original language. */
function fromTmdb(r, media = r.media_type) {
  if (media !== 'movie' && media !== 'tv') return null;             // skips people in search results
  const genreIds = r.genre_ids || (r.genres || []).map(g => g.id);
  const isAnime = genreIds.includes(16) && r.original_language === 'ja';
  return remember({
    key: `${media}:${r.id}`, id: r.id, media,
    kind: isAnime ? 'anime' : media === 'tv' ? 'series' : 'movie',
    title: r.title || r.name || 'Untitled',
    year: (r.release_date || r.first_air_date || '').slice(0, 4),
    rating: r.vote_average ? Number(r.vote_average.toFixed(1)) : null,
    poster: r.poster_path ? IMG + r.poster_path : '',
    overview: r.overview || '',
  });
}

/* RAWG game → item (RAWG rates out of 5, so double it to match TMDB's 10). */
function fromRawg(g) {
  return remember({
    key: `game:${g.id}`, id: g.id, media: 'game', kind: 'game', title: g.name,
    year: (g.released || '').slice(0, 4), rating: g.rating ? Number((g.rating * 2).toFixed(1)) : null,
    poster: g.background_image || '', overview: '',
  });
}

/* Extra detail for the detail page: description plus small pills. */
async function loadInfo(item) {
  if (item.media === 'game') {
    const g = await rawg('/games/' + item.id);
    const platforms = (g.platforms || []).slice(0, 3).map(p => p.platform.name).join(' · ');
    return { overview: g.description_raw, extra: [...(g.genres || []).slice(0, 3).map(x => x.name), platforms].filter(Boolean) };
  }
  const d = await tmdb(`/${item.media}/${item.id}`);
  const extra = (d.genres || []).slice(0, 3).map(g => g.name);
  if (d.runtime) extra.push(`${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m`);
  if (d.number_of_seasons) extra.push(`${d.number_of_seasons} seasons · ${d.number_of_episodes} eps`);
  return { overview: d.overview, extra };
}

/* ==========================================================================
   3. SIGN IN
   ========================================================================== */

function authMessage(text, ok = false) {
  const el = $('auth-msg');
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('ok', ok);
}

async function signIn() {
  authMessage('');
  const { error } = await sb.auth.signInWithPassword({ email: $('auth-email').value.trim(), password: $('auth-password').value });
  if (error) authMessage(error.message);
}

async function signUp() {
  authMessage('');
  if (!$('auth-form').reportValidity()) return;
  const { data, error } = await sb.auth.signUp({ email: $('auth-email').value.trim(), password: $('auth-password').value });
  if (error) authMessage(error.message);
  else if (!data.session) authMessage('Check your email to confirm your account, then sign in.', true);
}

/* ==========================================================================
   4. DATA  (Supabase)
   lists = [ { id, name, items: [item, ...] } ]      watch = [ { date, item } ]
   Row Level Security (schema.sql) makes sure each user only sees their own rows.
   ========================================================================== */

let lists = [];
let watch = [];

const isSaved = key => lists.some(list => list.items.some(item => item.key === key));

async function loadLists() {
  const columns = 'id,name,created_at,list_items(item_id,media_type,kind,title,poster,year,rating,added_at)';
  let { data, error } = await sb.from('lists').select(columns).order('created_at');
  if (error) throw error;
  if (!data.length) {                                           // first sign-in: make a starter list
    const first = await sb.from('lists').insert({ name: 'Favorites' }).select('id,name').single();
    if (first.error) throw first.error;
    data = [{ ...first.data, list_items: [] }];
  }
  lists = data.map(l => ({
    id: l.id, name: l.name,
    items: l.list_items.sort((a, b) => (a.added_at < b.added_at ? -1 : 1)).map(r => remember(fromRow(r))),
  }));
}

async function loadWatch() {
  const { data, error } = await sb.from('watch_log').select('*').order('watched_on');
  if (error) throw error;
  watch = data.map(r => ({ date: r.watched_on, item: remember(fromRow(r)) }));
}

async function createList(name, item) {
  const { data, error } = await sb.from('lists').insert({ name }).select('id,name').single();
  if (error) return toast('Could not create the list: ' + error.message);
  const list = { id: data.id, name: data.name, items: [] };
  lists.push(list);
  if (item) await toggleInList(list, item); else refresh();
}

async function toggleInList(list, item) {
  const has = list.items.some(i => i.key === item.key);
  const { error } = has
    ? await sb.from('list_items').delete().match({ list_id: list.id, item_id: item.id, media_type: item.media })
    : await sb.from('list_items').insert({ list_id: list.id, ...snapshot(item) });
  if (error) return toast('Could not save: ' + error.message);
  list.items = has ? list.items.filter(i => i.key !== item.key) : [...list.items, item];
  refresh();
}

async function logWatch(item) {
  const { error } = await sb.from('watch_log').insert({ ...snapshot(item), watched_on: todayKey });
  if (error) return toast('Could not log it: ' + error.message);
  watch.push({ date: todayKey, item });
  renderCalendar();
  toast('Added to today in Stats');
}

/* ==========================================================================
   5. SCREENS
   ========================================================================== */

/* ---- Building blocks (clone the templates in index.html) ---- */

function cardEl(item) {
  const el = $('tpl-card').content.firstElementChild.cloneNode(true);
  const art = el.querySelector('.art');
  art.setAttribute('style', artStyle(item));
  art.innerHTML = posterHTML(item) +
    `<em class="tag">${KIND_LABEL[item.kind]}</em><button class="cover" data-open="${item.key}" aria-label="Open ${esc(item.title)}"></button>`;
  el.querySelector('h3').textContent = item.title;
  el.querySelector('p').textContent = metaLine(item);
  return el;
}

function rowEl(item, { save = true } = {}) {
  const el = $('tpl-row').content.firstElementChild.cloneNode(true);
  const art = el.querySelector('.art');
  art.setAttribute('style', artStyle(item));
  art.innerHTML = posterHTML(item) + `<button class="cover" data-open="${item.key}" aria-label="Open ${esc(item.title)}"></button>`;
  el.querySelector('.row-text').dataset.open = item.key;
  el.querySelector('.row-title').textContent = item.title;
  el.querySelector('.row-meta').textContent = metaLine(item);
  const plus = el.querySelector('.plus');
  plus.hidden = !save;
  plus.dataset.save = item.key;
  plus.setAttribute('aria-label', 'Save ' + item.title + ' to a list');
  plus.classList.toggle('saved', isSaved(item.key));
  return el;
}

function tileEl(item) {
  const el = document.createElement('button');
  el.className = 'tile art';
  el.dataset.open = item.key;
  el.setAttribute('style', artStyle(item));
  el.setAttribute('aria-label', item.title);
  el.innerHTML = posterHTML(item);
  return el;
}

/* ---- Home ---- */

const RAILS = {
  'rail-trending': { path: '/trending/all/week', media: null },
  'rail-new': { path: '/movie/now_playing', media: 'movie' },
  'rail-anime': { path: '/discover/tv?with_genres=16&with_original_language=ja&sort_by=popularity.desc', media: 'tv' },
  'rail-top': { path: '/tv/top_rated', media: 'tv' },
};

async function loadHome() {
  await Promise.all(Object.entries(RAILS).map(async ([id, { path, media }]) => {
    const rail = $(id);
    rail.innerHTML = '<div class="card"><div class="skeleton"></div></div>'.repeat(3);
    try {
      const data = await tmdb(path);
      const items = data.results.map(r => fromTmdb(r, media || r.media_type)).filter(Boolean).slice(0, 14);
      rail.replaceChildren(...items.map(cardEl));
    } catch (err) {
      rail.innerHTML = '<p class="note" style="padding:0">Could not load titles. Check your TMDB token in config.js.</p>';
    }
  }));
}

/* ---- Search ---- */

const input = $('search-input');
let searchTimer = null;
let searchRun = 0;                                  // ignore answers that arrive after a newer search

function showResultsUI(typing) {
  $('history').hidden = typing;
  $('search-clear').hidden = !typing;
  if (!typing) {
    ['search-status', 'search-heading', 'search-empty'].forEach(id => { $(id).hidden = true; });
    $('search-results').replaceChildren();
  }
}

async function runSearch(text) {
  const run = ++searchRun;
  $('search-status').textContent = 'Searching…';
  $('search-status').hidden = false;
  try {
    const [movies, games] = await Promise.all([
      tmdb('/search/multi?query=' + encodeURIComponent(text)),
      CFG.RAWG_KEY ? rawg('/games?page_size=8&search=' + encodeURIComponent(text)) : { results: [] },
    ]);
    if (run !== searchRun) return;
    const items = [...movies.results.map(r => fromTmdb(r)).filter(Boolean), ...games.results.map(fromRawg)];
    $('search-status').hidden = true;
    $('search-heading').hidden = items.length === 0;
    $('search-heading').textContent = `${items.length} ${items.length === 1 ? 'result' : 'results'} for “${text}”`;
    $('search-empty').hidden = items.length > 0;
    $('search-results').replaceChildren(...items.map(item => rowEl(item)));
  } catch (err) {
    if (run !== searchRun) return;
    $('search-status').textContent = 'Search failed. Check your connection and keys, then try again.';
  }
}

input.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const text = input.value.trim();
  showResultsUI(Boolean(text));
  if (text) searchTimer = setTimeout(() => runSearch(text), 350);   // wait for a pause in typing
});
$('search-clear').addEventListener('click', () => { input.value = ''; showResultsUI(false); input.focus(); });

/* Search history (kept on this device). Saved when Enter is pressed or a result is opened. */
const HISTORY_KEY = 'nexus_history_v8';
let searchHistory = [];
try { searchHistory = JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch (err) { /* ignore */ }

const CLOCK = '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const CROSS = '<svg class="icon" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function saveHistory() { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(searchHistory)); } catch (err) { /* ignore */ } }

function renderHistory() {
  $('history-list').innerHTML = searchHistory.map(text => `
    <li class="history-item">
      <button class="history-query" data-query="${esc(text)}">${CLOCK}<span>${esc(text)}</span></button>
      <button class="history-remove" data-remove="${esc(text)}" aria-label="Remove ${esc(text)} from history">${CROSS}</button>
    </li>`).join('');
  $('history-empty').hidden = searchHistory.length > 0;
  $('history-clear').hidden = searchHistory.length === 0;
}

function rememberSearch(text) {
  text = text.trim();
  if (!text) return;
  searchHistory = [text, ...searchHistory.filter(h => h.toLowerCase() !== text.toLowerCase())].slice(0, 8);
  saveHistory();
  renderHistory();
}

$('search-form').addEventListener('submit', event => { event.preventDefault(); rememberSearch(input.value); input.blur(); });
$('search-results').addEventListener('click', event => { if (event.target.closest('[data-open]')) rememberSearch(input.value); });
$('history-list').addEventListener('click', event => {
  const query = event.target.closest('[data-query]');
  const remove = event.target.closest('[data-remove]');
  if (query) { input.value = query.dataset.query; input.dispatchEvent(new Event('input')); input.focus(); }
  if (remove) { searchHistory = searchHistory.filter(h => h !== remove.dataset.remove); saveHistory(); renderHistory(); }
});
$('history-clear').addEventListener('click', () => { searchHistory = []; saveHistory(); renderHistory(); });

/* ---- Stats (calendar) ---- */

const calendar = { year: now.getFullYear(), month: now.getMonth(), selected: todayKey };

function renderCalendar() {
  const { year, month, selected } = calendar;
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prefix = dateKey(year, month, 1).slice(0, 7);
  const count = watch.filter(w => w.date.startsWith(prefix)).length;

  $('cal-month').textContent = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  $('cal-summary').textContent = `${count} ${count === 1 ? 'title' : 'titles'} watched this month`;

  // Blank cells push day 1 under the right weekday (weeks start on Sunday).
  let cells = '<div class="day blank"></div>'.repeat(firstDay.getDay());
  for (let day = 1; day <= daysInMonth; day++) {
    const key = dateKey(year, month, day);
    const first = watch.find(w => w.date === key);
    const classes = ['day', first && 'art', key === todayKey && 'today', key === selected && 'selected'].filter(Boolean).join(' ');
    cells += `<button class="${classes}" data-date="${key}" ${first ? `style="${artStyle(first.item)}"` : ''} aria-label="${key}">
      ${first ? posterHTML(first.item) : ''}<span class="day-num">${day}</span></button>`;
  }
  $('cal-grid').innerHTML = cells;

  // Under the calendar: what was watched on the selected day.
  const picked = selected ? watch.filter(w => w.date === selected) : [];
  $('day-list').replaceChildren(...picked.map(w => rowEl(w.item, { save: false })));
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

/* ---- My List ---- */

let openListId = null;                               // list shown full-screen, if any

function renderLists() {
  $('lists').replaceChildren(...lists.map(list => {
    const box = $('tpl-vault').content.firstElementChild.cloneNode(true);
    box.querySelector('.name').textContent = list.name;
    box.querySelector('.count').textContent = list.items.length + ' saved';

    // Up to 4 titles: show them all. More than 4: three posters, then a "+N" box.
    const many = list.items.length > 4;
    const nodes = list.items.slice(0, many ? 3 : 4).map(tileEl);
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

function renderListView() {
  const list = lists.find(l => l.id === openListId);
  $('list-view').hidden = !list;
  if (!list) { openListId = null; return; }
  $('list-view-title').textContent = list.name;
  $('list-view-count').textContent = list.items.length + ' saved';
  $('list-view-grid').replaceChildren(...list.items.map(tileEl));
}

$('lists').addEventListener('click', event => {
  const more = event.target.closest('[data-open-list]');
  if (!more) return;
  openListId = more.dataset.openList;
  renderListView();
  $('list-view').scrollTop = 0;
});
$('list-view-back').addEventListener('click', () => { openListId = null; renderListView(); });

/* Redraw everything that depends on the lists. */
function refresh() {
  document.querySelectorAll('[data-save]').forEach(el => el.classList.toggle('saved', isSaved(el.dataset.save)));
  renderLists();
  renderListView();
  if (!$('save-sheet').hidden) renderSaveSheet();
}

/* ---- Save buttons, "Save to..." picker and "New list" form ---- */

let pendingItem = null;                              // the title being saved while the picker is open

function handleSave(key) {
  const item = cache.get(key);
  if (!item || !lists.length) return;
  if (lists.length === 1) { toggleInList(lists[0], item); return; }   // one list: no need to ask
  pendingItem = item;
  renderSaveSheet();
  $('save-sheet').hidden = false;
}

function renderSaveSheet() {
  $('save-sheet-sub').textContent = pendingItem.title;
  $('save-sheet-options').innerHTML = lists.map(list =>
    `<button class="sheet-option ${list.items.some(i => i.key === pendingItem.key) ? 'on' : ''}" data-pick="${list.id}">${esc(list.name)}<small>${list.items.length}</small></button>`
  ).join('');
}

function closeSaveSheet() { $('save-sheet').hidden = true; pendingItem = null; }
function openNewList() { $('new-list').hidden = false; $('new-list-name').focus(); }
function closeNewList() { $('new-list').hidden = true; $('new-list-name').value = ''; }

$('save-sheet-options').addEventListener('click', event => {
  const option = event.target.closest('[data-pick]');
  if (option) toggleInList(lists.find(l => l.id === option.dataset.pick), pendingItem);
});
$('save-sheet-done').addEventListener('click', closeSaveSheet);
$('save-sheet').addEventListener('click', event => { if (event.target === event.currentTarget) closeSaveSheet(); });
$('save-sheet-new').addEventListener('click', openNewList);

$('new-list-btn').addEventListener('click', () => { pendingItem = null; openNewList(); });
$('new-list-cancel').addEventListener('click', closeNewList);
$('new-list').addEventListener('click', event => { if (event.target === event.currentTarget) closeNewList(); });
$('new-list-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('new-list-name').value.trim();
  if (!name) return;
  closeNewList();
  createList(name, pendingItem);                     // also adds the title being saved, if any
});

/* ---- Detail page ---- */

let detailItem = null;

function renderDetail(item, info) {
  $('detail-art').setAttribute('style', artStyle(item));
  $('detail-art').innerHTML = posterHTML({ ...item, poster: item.poster.replace('/w500/', '/w780/') });
  $('detail-pills').innerHTML = `${item.rating ? `<span class="rating">★ ${item.rating}</span>` : ''}${item.year ? `<span>${item.year}</span>` : ''}<span>${KIND_LABEL[item.kind]}</span>`;
  $('detail-title').textContent = item.title;
  $('detail-extra').innerHTML = (info ? info.extra : []).map(text => `<span>${esc(text)}</span>`).join('');
  $('detail-synopsis').textContent = (info && info.overview) || item.overview || (info ? 'No description available.' : 'Loading…');
  $('detail-save').dataset.save = item.key;
  $('detail-save').classList.toggle('saved', isSaved(item.key));
  $('detail-watched').textContent = item.kind === 'game' ? 'I played this today' : 'I watched this today';
}

async function openDetail(item) {
  detailItem = item;
  renderDetail(item, null);
  $('detail').hidden = false;
  $('detail').scrollTop = 0;
  try {
    const info = await loadInfo(item);
    if (detailItem === item) renderDetail(item, info);          // skip if another title was opened meanwhile
  } catch (err) {
    if (detailItem === item) renderDetail(item, { extra: [], overview: '' });
  }
}

$('detail-back').addEventListener('click', () => { $('detail').hidden = true; detailItem = null; });
$('detail-watched').addEventListener('click', () => { if (detailItem) logWatch(detailItem); });

/* ==========================================================================
   6. EVENTS
   ========================================================================== */

/* One listener for every poster (data-open) and save button (data-save). */
document.addEventListener('click', event => {
  const open = event.target.closest('[data-open]');
  if (open) { const item = cache.get(open.dataset.open); if (item) openDetail(item); return; }
  const save = event.target.closest('[data-save]');
  if (save) handleSave(save.dataset.save);
});

$('auth-form').addEventListener('submit', event => { event.preventDefault(); signIn(); });
$('auth-signup').addEventListener('click', signUp);
$('sign-out').addEventListener('click', () => sb.auth.signOut());

/* ==========================================================================
   7. START
   ========================================================================== */

let startedFor = null;

async function start(user) {
  if (startedFor === user.id) return;
  startedFor = user.id;
  $('auth').hidden = true;
  try { await Promise.all([loadLists(), loadWatch()]); }
  catch (err) { toast('Could not load your lists: ' + err.message); }
  refresh();
  renderCalendar();
  renderHistory();
  loadHome();
}

function showSignIn() {
  startedFor = null;
  lists = [];
  watch = [];
  cache.clear();
  refresh();
  renderCalendar();
  $('auth').hidden = false;
}

$('rawg-credit').hidden = !CFG.RAWG_KEY;

if (!sb || !CFG.TMDB_TOKEN) {
  showSignIn();
  authMessage('Setup needed: add your TMDB and Supabase keys in config.js, then reload.');
} else {
  // Runs once at load and again on every sign-in / sign-out.
  // setTimeout avoids calling Supabase from inside its own callback.
  sb.auth.onAuthStateChange((event, session) => {
    setTimeout(() => (session ? start(session.user) : showSignIn()), 0);
  });
}
