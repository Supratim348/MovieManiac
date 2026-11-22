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

/* PREVIEW MODE: skips sign-in and Supabase so you can work on the look of the app.
   Nothing is saved. Turn it on with PREVIEW: true in config.js, or add ?preview to the address. */
const PREVIEW = Boolean(CFG.PREVIEW) || new URLSearchParams(location.search).has('preview');

const IMG = 'https://image.tmdb.org/t/p/w500';
const BACKDROP = 'https://image.tmdb.org/t/p/w780';
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
const prettyDate = key => new Date(key + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
  (item.poster ? `<img src="${esc(item.poster)}" alt="" loading="lazy" onerror="this.remove()">` : '') + `<b data-pk="${esc(item.key)}">${esc(item.title)}</b>`;
const metaLine = item => [item.year, KIND_LABEL[item.kind], item.rating ? '★ ' + item.rating : ''].filter(Boolean).join(' · ');

/* The columns saved to Supabase for a title. */
const snapshot = item => ({
  item_id: item.id, media_type: item.media, kind: item.kind, title: item.title,
  poster: item.poster || null, year: Number(item.year) || null, rating: item.rating || null,
});
/* ...and back again. */
const fromRow = r => ({
  key: `${r.media_type}:${r.item_id}`, id: r.item_id, media: r.media_type, kind: r.kind, title: r.title,
  year: r.year || '', rating: r.rating ? Number(r.rating) : null, overview: '', backdrop: '',
  poster: r.media_type === 'game' && coverCache[r.item_id] ? steamCover(coverCache[r.item_id]) : r.poster || '',
});

/* A few made-up titles so every screen has something to show in preview mode. */
const SAMPLE = [
  ['Interstellar', 'movie', 2014, 8.7, 'A team of explorers travels through a wormhole to save humanity.'],
  ['The Dark Knight', 'movie', 2008, 9.0, 'Batman faces the Joker, who pushes Gotham toward chaos.'],
  ['Dune', 'movie', 2021, 8.0, 'Paul Atreides travels to the desert planet Arrakis.'],
  ['Breaking Bad', 'series', 2008, 9.5, 'A chemistry teacher turns to making methamphetamine.'],
  ['Dark', 'series', 2017, 8.7, 'A missing child exposes a web of time travel and family secrets.'],
  ['Attack on Titan', 'anime', 2013, 9.1, 'Humanity lives behind walls to escape giant Titans.'],
  ['Death Note', 'anime', 2006, 9.0, 'A student finds a notebook that kills anyone named in it.'],
  ['Jujutsu Kaisen', 'anime', 2020, 8.6, 'Yuji Itadori joins a school of sorcerers.'],
  ['Red Dead Redemption 2', 'game', 2018, 9.7, 'An outlaw gang runs from the law in 1899.'],
  ['Ghost of Tsushima', 'game', 2020, 9.2, 'A samurai defends Tsushima island from invasion.'],
].map(([title, kind, year, rating, overview], i) => remember({
  key: `${kind === 'movie' ? 'movie' : kind === 'game' ? 'game' : 'tv'}:${900 + i}`, id: 900 + i,
  media: kind === 'movie' ? 'movie' : kind === 'game' ? 'game' : 'tv', kind, title, year, rating, poster: '', overview,
}));
const useSample = PREVIEW && !CFG.TMDB_TOKEN;      // no TMDB token in preview → use the sample titles

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
    backdrop: r.backdrop_path ? BACKDROP + r.backdrop_path : '',
    overview: r.overview || '',
  });
}

/* ---- Game covers ----------------------------------------------------------
   RAWG only has wide screenshots (background_image), which look bad cropped into a
   portrait poster. Steam serves real portrait box art for free, so: ask RAWG which
   Steam page the game has, read the app id, and use Steam's library_600x900.jpg.
   Games that aren't on Steam keep the RAWG image. Answers are cached on this device. */
const COVER_KEY = 'nexus_covers_v1';
let coverCache = {};                                   // { rawgId: steamAppId | 0 (none) }
try { coverCache = JSON.parse(localStorage.getItem(COVER_KEY)) || {}; } catch (err) { /* ignore */ }
const saveCovers = () => { try { localStorage.setItem(COVER_KEY, JSON.stringify(coverCache)); } catch (err) { /* ignore */ } };
const steamCover = appId => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
const imageLoads = url => new Promise(done => {
  const img = new Image();
  img.onload = () => done(img.naturalWidth > 1);
  img.onerror = () => done(false);
  img.src = url;
});

/* Swap the cover everywhere this title is on screen (cards, rows, tiles, detail page). */
function setPoster(item, url) {
  item.poster = url;
  document.querySelectorAll('b[data-pk]').forEach(label => {
    if (label.dataset.pk !== item.key) return;
    const before = label.previousElementSibling;
    if (before && before.tagName === 'IMG') { before.src = url; return; }
    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => img.remove();
    img.src = url;
    label.before(img);
  });
}

async function findGameCover(item) {
  if (!item || item.media !== 'game' || !CFG.RAWG_KEY || useSample) return;
  let appId = coverCache[item.id];
  if (appId === undefined) {
    try {
      const data = await rawg(`/games/${item.id}/stores`);
      const steam = (data.results || []).find(s => s.store_id === 1 || /store\.steampowered\.com/.test(s.url || ''));
      const match = steam && (steam.url || '').match(/\/app\/(\d+)/);
      appId = match ? Number(match[1]) : 0;
      if (appId && !(await imageLoads(steamCover(appId)))) appId = 0;   // some old apps have no portrait art
    } catch (err) { return; }                                           // network hiccup: try again next time
    coverCache[item.id] = appId;
    saveCovers();
  }
  if (appId) setPoster(item, steamCover(appId));
}

/* RAWG game → item (RAWG rates out of 5, so double it to match TMDB's 10). */
function fromRawg(g) {
  const appId = coverCache[g.id];
  return remember({
    key: `game:${g.id}`, id: g.id, media: 'game', kind: 'game', title: g.name,
    year: (g.released || '').slice(0, 4), rating: g.rating ? Number((g.rating * 2).toFixed(1)) : null,
    poster: appId ? steamCover(appId) : g.background_image || '',
    backdrop: g.background_image || '', overview: '',
  });
}

/* Extra detail for the detail page. Always the same shape, whatever the source. */
const EMPTY_INFO = { overview: '', tagline: '', genres: [], meta: [], facts: [], cast: [], shots: [], related: [], link: null, backdrop: '' };
const langName = code => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code); } catch (err) { return code || ''; } };
const hoursMins = min => `${Math.floor(min / 60)}h ${min % 60}m`;

async function loadInfo(item) {
  if (useSample) return { ...EMPTY_INFO, overview: item.overview, genres: [KIND_LABEL[item.kind]] };

  if (item.media === 'game') {
    const [game, shots, suggested, series] = await Promise.allSettled([
      rawg('/games/' + item.id),
      rawg(`/games/${item.id}/screenshots?page_size=8`),
      rawg(`/games/${item.id}/suggested?page_size=10`),
      rawg(`/games/${item.id}/game-series?page_size=10`),
    ]);
    if (game.status !== 'fulfilled') throw game.reason;
    const g = game.value;
    const names = list => (list || []).map(x => x.name).join(', ');
    const related = [suggested, series]
      .map(r => (r.status === 'fulfilled' ? r.value.results || [] : []))
      .find(list => list.length) || [];
    const relatedItems = related.slice(0, 10).map(fromRawg);
    relatedItems.forEach(findGameCover);
    return {
      ...EMPTY_INFO,
      overview: g.description_raw,
      genres: (g.genres || []).slice(0, 4).map(x => x.name),
      meta: g.metacritic ? ['Metacritic ' + g.metacritic] : [],
      facts: [
        ['Released', g.released ? prettyDate(g.released) : ''],
        ['Developer', names((g.developers || []).slice(0, 2))],
        ['Publisher', names((g.publishers || []).slice(0, 2))],
        ['Platforms', (g.platforms || []).slice(0, 5).map(p => p.platform.name).join(', ')],
        ['Age rating', g.esrb_rating ? g.esrb_rating.name : ''],
        ['Avg. playtime', g.playtime ? g.playtime + ' hours' : ''],
      ].filter(f => f[1]),
      shots: shots.status === 'fulfilled' ? (shots.value.results || []).map(x => x.image) : [],
      related: relatedItems,
      link: g.website ? { url: g.website, label: 'Official website' } : null,
      backdrop: g.background_image || item.backdrop,
    };
  }

  const d = await tmdb(`/${item.media}/${item.id}?append_to_response=credits,videos,recommendations`);
  const isTv = item.media === 'tv';
  const crew = (d.credits && d.credits.crew) || [];
  const videos = (d.videos && d.videos.results || []).filter(v => v.site === 'YouTube');
  const trailer = videos.find(v => v.type === 'Trailer' && v.official) || videos.find(v => v.type === 'Trailer') || videos[0];
  const first = (list, field) => (list && list[0] ? list[0][field] : '');
  const meta = [];
  if (d.runtime) meta.push(hoursMins(d.runtime));
  if (d.number_of_seasons) meta.push(`${d.number_of_seasons} ${d.number_of_seasons === 1 ? 'season' : 'seasons'}`);
  const facts = isTv ? [
    ['First aired', d.first_air_date ? prettyDate(d.first_air_date) : ''],
    ['Episodes', d.number_of_episodes],
    ['Episode length', first(d.episode_run_time) ? first(d.episode_run_time) + ' min' : ''],
    ['Status', d.status],
    ['Network', first(d.networks, 'name')],
    ['Created by', (d.created_by || []).slice(0, 2).map(c => c.name).join(', ')],
    ['Language', langName(d.original_language)],
  ] : [
    ['Released', d.release_date ? prettyDate(d.release_date) : ''],
    ['Director', crew.filter(c => c.job === 'Director').slice(0, 2).map(c => c.name).join(', ')],
    ['Status', d.status],
    ['Language', langName(d.original_language)],
  ];
  return {
    ...EMPTY_INFO,
    overview: d.overview,
    tagline: d.tagline || '',
    genres: (d.genres || []).slice(0, 4).map(g => g.name),
    meta,
    facts: facts.filter(f => f[1]),
    cast: ((d.credits && d.credits.cast) || []).slice(0, 12).map(c => ({
      name: c.name, sub: c.character || '', img: c.profile_path ? 'https://image.tmdb.org/t/p/w185' + c.profile_path : '',
    })),
    related: ((d.recommendations && d.recommendations.results) || []).slice(0, 12).map(r => fromTmdb(r, item.media)).filter(Boolean),
    link: trailer ? { url: 'https://www.youtube.com/watch?v=' + trailer.key, label: '▶  Watch trailer' } : null,
    backdrop: d.backdrop_path ? BACKDROP + d.backdrop_path : item.backdrop,
  };
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
  if (PREVIEW) { lists = [{ id: 'preview-favorites', name: 'Favorites', items: SAMPLE.slice(0, 6) }]; return; }
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
  if (PREVIEW) {
    const day = d => dateKey(now.getFullYear(), now.getMonth(), d);
    watch = [[2, 0], [5, 3], [5, 5], [9, 4], [14, 8], [now.getDate(), 1]].map(([d, i]) => ({ id: 'p' + d + '-' + i, date: day(d), item: SAMPLE[i] }));
    return;
  }
  const { data, error } = await sb.from('watch_log').select('*').order('watched_on');
  if (error) throw error;
  watch = data.map(r => ({ id: r.id, date: r.watched_on, item: remember(fromRow(r)) }));
}

async function createList(name, item) {
  let id = 'preview-' + Date.now();
  if (!PREVIEW) {
    const { data, error } = await sb.from('lists').insert({ name }).select('id,name').single();
    if (error) return toast('Could not create the list');
    id = data.id;
  }
  const list = { id, name, items: [] };
  lists.push(list);
  if (item) await toggleInList(list, item); else refresh();
}

async function deleteList(id) {
  const list = lists.find(l => l.id === id);
  if (!list || lists.length < 2) return;                       // always keep at least one list
  if (!confirm(`Delete "${list.name}" and its ${list.items.length} saved titles?`)) return;
  const { error } = PREVIEW ? {} : await sb.from('lists').delete().eq('id', id);   // its items are deleted with it
  if (error) return toast('Could not delete the list: ' + error.message);
  lists = lists.filter(l => l.id !== id);
  if (openListId === id) openListId = null;
  refresh();
  toast('List deleted');
}

async function toggleInList(list, item) {
  const has = list.items.some(i => i.key === item.key);
  const { error } = PREVIEW ? {} : has
    ? await sb.from('list_items').delete().match({ list_id: list.id, item_id: item.id, media_type: item.media })
    : await sb.from('list_items').insert({ list_id: list.id, ...snapshot(item) });
  if (error) return toast('Could not save: ' + error.message);
  list.items = has ? list.items.filter(i => i.key !== item.key) : [...list.items, item];
  refresh();
}

async function logWatch(item, date = todayKey) {
  if (watch.some(w => w.item.key === item.key && w.date === date)) return toast('Already Logged');
  const { data, error } = PREVIEW
    ? { data: { id: 'p' + Date.now() } }
    : await sb.from('watch_log').insert({ ...snapshot(item), watched_on: date }).select('id').single();
  if (error) return toast('Could not log it: ' + error.message);
  watch.push({ id: data.id, date, item });
  const [y, m] = date.split('-').map(Number);                  // show that month in Stats, day selected
  calendar.year = y;
  calendar.month = m - 1;
  calendar.selected = date;
  renderCalendar();
  renderWatchedButton(item);
  toast('Added');
}

async function removeWatch(id) {
  const { error } = PREVIEW ? {} : await sb.from('watch_log').delete().eq('id', id);
  if (error) return toast('Could not remove it: ' + error.message);
  watch = watch.filter(w => w.id !== id);
  renderCalendar();
  toast('Removed');
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

/* Each rail: which category chip it belongs to (kind), whether "For you" shows it (all),
   and how to get its titles. Rails in the same chip show in this order. */
const inKind = kind => list => list.filter(i => i && i.kind === kind);
const tmdbList = (path, media, kind) => async () => {
  const data = await tmdb(path);
  const items = data.results.map(r => fromTmdb(r, media || r.media_type));
  return kind ? inKind(kind)(items) : items.filter(Boolean);
};
const rawgList = query => async () => (await rawg('/games?exclude_additions=true&page_size=14&' + query)).results.map(fromRawg);
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const ANIME_TV = '/discover/tv?with_genres=16&with_original_language=ja&sort_by=';

const HOME_RAILS = [
  { id: 'trending', title: 'Top 10 this week', kind: null, all: true, ranked: true, load: tmdbList('/trending/all/week') },
  { id: 'cinemas', title: 'New in cinemas', kind: 'movie', all: true, load: tmdbList('/movie/now_playing', 'movie', 'movie') },
  { id: 'anime-pop', title: 'Popular anime', kind: 'anime', all: true, load: tmdbList(ANIME_TV + 'popularity.desc', 'tv') },
  { id: 'series-top', title: 'Top rated series', kind: 'series', all: true, load: tmdbList('/tv/top_rated', 'tv', 'series') },
  { id: 'games-pop', title: 'Popular games', kind: 'game', all: true, load: rawgList('ordering=-added') },

  { id: 'movie-pop', title: 'Popular movies', kind: 'movie', load: tmdbList('/movie/popular', 'movie', 'movie') },
  { id: 'movie-top', title: 'Top rated movies', kind: 'movie', load: tmdbList('/movie/top_rated', 'movie', 'movie') },
  { id: 'movie-soon', title: 'Coming soon', kind: 'movie', load: tmdbList('/movie/upcoming', 'movie', 'movie') },

  { id: 'series-pop', title: 'Popular series', kind: 'series', load: tmdbList('/tv/popular', 'tv', 'series') },
  { id: 'series-air', title: 'On the air now', kind: 'series', load: tmdbList('/tv/on_the_air', 'tv', 'series') },

  { id: 'anime-top', title: 'Top rated anime', kind: 'anime', load: tmdbList(ANIME_TV + 'vote_average.desc&vote_count.gte=800', 'tv') },
  { id: 'anime-new', title: 'Airing recently', kind: 'anime', load: tmdbList(ANIME_TV + 'popularity.desc&first_air_date.gte=' + daysAgo(540), 'tv') },
  { id: 'anime-film', title: 'Anime films', kind: 'anime', load: tmdbList('/discover/movie?with_genres=16&with_original_language=ja&sort_by=popularity.desc', 'movie') },

  { id: 'games-top', title: 'Critics’ favourites', kind: 'game', load: rawgList('ordering=-metacritic&metacritic=80,100') },
  { id: 'games-new', title: 'Recently released', kind: 'game', load: rawgList(`ordering=-added&dates=${daysAgo(120)},${daysAgo(0)}`) },
];

const railCache = {};                                           // id → items, so switching chips is instant
let homeGroup = 'all';
const gamesAvailable = () => Boolean(CFG.RAWG_KEY) || useSample;

function rankedCard(item, n) {
  const el = cardEl(item);
  el.classList.add('ranked');
  el.insertAdjacentHTML('afterbegin', `<i class="rank">${n}</i>`);
  return el;
}

function fillRail(def, items) {
  const rail = $('rail-' + def.id);
  if (!rail) return;                                            // user switched chips meanwhile
  if (!items.length) { rail.closest('.rail-section').hidden = true; return; }
  rail.replaceChildren(...items.map((item, n) => (def.ranked ? rankedCard(item, n + 1) : cardEl(item))));
}

async function loadRail(def) {
  if (railCache[def.id]) return fillRail(def, railCache[def.id]);
  try {
    let items;
    if (useSample) {
      const pool = def.kind ? SAMPLE.filter(i => i.kind === def.kind) : SAMPLE;
      const spin = HOME_RAILS.indexOf(def) % Math.max(pool.length, 1);
      items = [...pool.slice(spin), ...pool.slice(0, spin)];
    } else {
      items = (await def.load()).slice(0, def.ranked ? 10 : 14);
    }
    railCache[def.id] = items;
    fillRail(def, items);
    if (def.kind === 'game') items.forEach(findGameCover);
  } catch (err) {
    const rail = $('rail-' + def.id);
    if (rail) rail.innerHTML = '<p class="note" style="padding:0">Could not load titles right now.</p>';
  }
}

function renderHomeRails() {
  const defs = HOME_RAILS.filter(def =>
    (homeGroup === 'all' ? def.all : def.kind === homeGroup) && (def.kind !== 'game' || gamesAvailable()));
  $('home-rails').replaceChildren(...defs.map(def => {
    const section = document.createElement('section');
    section.className = 'rail-section';
    section.innerHTML = `<h2 class="section-title">${esc(def.title)}</h2><div class="rail" id="rail-${def.id}">${
      railCache[def.id] ? '' : '<div class="card"><div class="skeleton"></div></div>'.repeat(3)}</div>`;
    return section;
  }));
  if (homeGroup === 'game' && !gamesAvailable()) {
    $('home-rails').innerHTML = `<p class="note">${esc(NEEDS_RAWG)}</p>`;
    return;
  }
  defs.forEach(loadRail);
}

$('home-chips').addEventListener('click', event => {
  const chip = event.target.closest('[data-group]');
  if (!chip || chip.dataset.group === homeGroup) return;
  homeGroup = chip.dataset.group;
  document.querySelectorAll('#home-chips .chip').forEach(c => {
    c.classList.toggle('on', c === chip);
    c.setAttribute('aria-checked', c === chip);
  });
  chip.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  renderHomeRails();
});

/* ---- Spotlight banners ---- */

function spotEl(item) {
  const el = document.createElement('article');
  el.className = 'spot-slide';
  el.setAttribute('style', artStyle(item));
  el.innerHTML =
    (item.backdrop ? `<img src="${esc(item.backdrop)}" alt="" onerror="this.remove()">` : '') +
    `<div class="spot-info"><em class="tag">${KIND_LABEL[item.kind]}</em><h2>${esc(item.title)}</h2><p>${esc(metaLine(item))}</p></div>` +
    `<button class="plus" data-save="${esc(item.key)}" aria-label="Save ${esc(item.title)} to a list"></button>` +
    `<button class="cover" data-open="${esc(item.key)}" aria-label="Open ${esc(item.title)}"></button>`;
  el.querySelector('.plus').classList.toggle('saved', isSaved(item.key));
  return el;
}

let spotTimer = null;
function startSpotTimer() {
  clearInterval(spotTimer);
  spotTimer = setInterval(() => {
    const track = $('spot-track');
    if (!$('tab-home').checked || !$('detail').hidden || document.hidden || track.children.length < 2) return;
    const next = (Math.round(track.scrollLeft / track.clientWidth) + 1) % track.children.length;
    track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' });
  }, 5500);
}

async function loadSpotlight() {
  let items;
  try {
    items = useSample
      ? SAMPLE.slice(0, 6)
      : (await tmdb('/trending/all/week')).results.map(r => fromTmdb(r)).filter(i => i && i.backdrop).slice(0, 6);
  } catch (err) { return; }
  if (!items.length) return;
  $('spot-track').replaceChildren(...items.map(spotEl));
  $('spot-dots').innerHTML = items.map((_, n) => `<span class="${n ? '' : 'on'}"></span>`).join('');
  $('spot').hidden = false;
  startSpotTimer();
}

$('spot-track').addEventListener('scroll', () => {
  const track = $('spot-track');
  const at = Math.round(track.scrollLeft / (track.clientWidth || 1));
  [...$('spot-dots').children].forEach((dot, n) => dot.classList.toggle('on', n === at));
}, { passive: true });
$('spot-track').addEventListener('pointerdown', startSpotTimer);   // give people time after they touch it

function loadHome() {
  $('chip-games').hidden = !gamesAvailable();
  renderHomeRails();
  loadSpotlight();
}

/* ---- Search ---- */

const input = $('search-input');
let searchTimer = null;
let searchRun = 0;                                  // ignore answers that arrive after a newer search

/* The category picker. Search and the "Popular" rail only use the chosen one. */
const KINDS = {
  movie: { label: 'Movies', placeholder: 'Search movies' },
  series: { label: 'Series', placeholder: 'Search TV series' },
  anime: { label: 'Anime', placeholder: 'Search anime' },
  game: { label: 'Games', placeholder: 'Search games' },
};
let searchKind = 'movie';

function syncKinds() {
  document.querySelectorAll('#search-kinds .kind').forEach(btn => {
    const on = btn.dataset.kind === searchKind;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-checked', on);
  });
  input.placeholder = KINDS[searchKind].placeholder;
}

const NEEDS_RAWG = 'Game search needs a RAWG key. Uncomment RAWG_KEY in config.js and paste your key.';

async function searchTitles(kind, text) {
  const q = encodeURIComponent(text);
  if (useSample) return SAMPLE.filter(i => i.kind === kind && i.title.toLowerCase().includes(text.toLowerCase()));
  if (kind === 'game') {
    if (!CFG.RAWG_KEY) throw new Error(NEEDS_RAWG);
    const data = await rawg(`/games?page_size=12&exclude_additions=true&search=${q}`);
    return data.results.map(fromRawg);
  }
  if (kind === 'movie') {
    const data = await tmdb('/search/movie?query=' + q);
    return data.results.map(r => fromTmdb(r, 'movie')).filter(i => i && i.kind === 'movie');   // anime films live under Anime
  }
  if (kind === 'series') {
    const data = await tmdb('/search/tv?query=' + q);
    return data.results.map(r => fromTmdb(r, 'tv')).filter(i => i && i.kind === 'series');
  }
  const [tv1, tv2, films] = await Promise.all([                                                  // anime: series and films
    tmdb('/search/tv?query=' + q), tmdb('/search/tv?page=2&query=' + q), tmdb('/search/movie?query=' + q),
  ]);
  return [
    ...[...tv1.results, ...tv2.results].map(r => fromTmdb(r, 'tv')),
    ...films.results.map(r => fromTmdb(r, 'movie')),
  ].filter(i => i && i.kind === 'anime');
}

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
  const kind = searchKind;
  $('search-status').textContent = 'Searching…';
  $('search-status').hidden = false;
  $('search-heading').hidden = true;
  $('search-empty').hidden = true;
  $('search-results').replaceChildren();
  try {
    const items = await searchTitles(kind, text);
    if (run !== searchRun) return;
    $('search-status').hidden = true;
    $('search-heading').hidden = items.length === 0;
    $('search-heading').textContent = `${items.length} ${items.length === 1 ? 'result' : 'results'} in ${KINDS[kind].label} for “${text}”`;
    $('search-empty').hidden = items.length > 0;
    $('search-results').replaceChildren(...items.map(item => rowEl(item)));
    if (kind === 'game') items.forEach(findGameCover);            // upgrade to portrait box art
  } catch (err) {
    if (run !== searchRun) return;
    $('search-status').textContent = err.message === NEEDS_RAWG ? NEEDS_RAWG : 'Search failed. Check your connection and keys, then try again.';
  }
}

$('search-kinds').addEventListener('click', event => {
  const btn = event.target.closest('[data-kind]');
  if (!btn || btn.dataset.kind === searchKind) return;
  searchKind = btn.dataset.kind;
  syncKinds();
  const text = input.value.trim();
  if (text) { clearTimeout(searchTimer); runSearch(text); }
});

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
  $('day-list').replaceChildren(...picked.map(w => {
    const row = rowEl(w.item, { save: false });
    const remove = document.createElement('button');          // the round × button on the right
    remove.className = 'plus plus--row saved';
    remove.dataset.unwatch = w.id;
    remove.setAttribute('aria-label', 'Remove ' + w.item.title + ' from this day');
    row.append(remove);
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

$('day-list').addEventListener('click', event => {
  const remove = event.target.closest('[data-unwatch]');
  if (remove) removeWatch(remove.dataset.unwatch);
});
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
    const del = box.querySelector('.vault-delete');
    del.hidden = lists.length < 2;                                // the last list can't be deleted
    del.dataset.deleteList = list.id;
    del.setAttribute('aria-label', 'Delete list ' + list.name);

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
  const del = event.target.closest('[data-delete-list]');
  if (del) { deleteList(del.dataset.deleteList); return; }
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

/* ---- Detail page (opens when a poster is tapped) ---- */

let detailItem = null;
const detailStack = [];                                           // titles we came from, so Back goes one step back

const fillDetailRail = (sectionId, railId, nodes) => {
  $(sectionId).hidden = nodes.length === 0;
  $(railId).replaceChildren(...nodes);
};

function castEl(person) {
  const el = document.createElement('div');
  el.className = 'cast';
  el.innerHTML = `<span class="cast-photo">${person.img ? `<img src="${esc(person.img)}" alt="" loading="lazy" onerror="this.remove()">` : ''}${esc(person.name.slice(0, 1))}</span>` +
    `<b>${esc(person.name)}</b><small>${esc(person.sub)}</small>`;
  return el;
}

function shotEl(url) {
  const el = document.createElement('a');
  el.className = 'shot';
  el.href = url;
  el.target = '_blank';
  el.rel = 'noopener';
  el.innerHTML = `<img src="${esc(url)}" alt="Screenshot" loading="lazy" onerror="this.parentNode.remove()">`;
  return el;
}

function renderDetail(item, info) {
  const loaded = Boolean(info);
  info = info || EMPTY_INFO;
  const wide = info.backdrop || item.backdrop || '';
  const backdrop = $('detail-backdrop');
  backdrop.className = 'd-backdrop' + (wide ? '' : ' blur');         // no wide image: use the poster, blurred
  backdrop.setAttribute('style', artStyle(item));
  backdrop.innerHTML = wide || item.poster ? `<img src="${esc(wide || item.poster)}" alt="" onerror="this.remove()">` : '';

  $('detail-art').setAttribute('style', artStyle(item));
  $('detail-art').innerHTML = posterHTML({ ...item, poster: (item.poster || '').replace('/w500/', '/w780/') });
  $('detail-kind').textContent = KIND_LABEL[item.kind];
  $('detail-title').textContent = item.title;
  $('detail-tagline').textContent = info.tagline;
  $('detail-tagline').hidden = !info.tagline;

  const pills = [
    item.rating ? `<span class="rating">★ ${item.rating}</span>` : '',
    item.year ? `<span>${esc(item.year)}</span>` : '',
    ...info.meta.map(text => `<span>${esc(text)}</span>`),
  ];
  $('detail-pills').innerHTML = pills.join('');
  $('detail-extra').innerHTML = info.genres.map(text => `<span>${esc(text)}</span>`).join('');

  const synopsis = $('detail-synopsis');
  synopsis.textContent = info.overview || item.overview || (loaded ? 'No description available.' : 'Loading…');
  synopsis.classList.add('clamp');
  $('detail-more').textContent = 'Read more';
  requestAnimationFrame(() => { $('detail-more').hidden = synopsis.scrollHeight <= synopsis.clientHeight + 1; });

  $('detail-facts').innerHTML = info.facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
  const link = $('detail-link');
  link.hidden = !info.link;
  if (info.link) { link.href = info.link.url; link.textContent = info.link.label; }

  fillDetailRail('detail-cast-sec', 'detail-cast', info.cast.map(castEl));
  fillDetailRail('detail-shots-sec', 'detail-shots', info.shots.map(shotEl));
  fillDetailRail('detail-related-sec', 'detail-related', info.related.map(cardEl));

  $('detail-save').dataset.save = item.key;
  $('detail-save').classList.toggle('saved', isSaved(item.key));
  renderWatchedButton(item);
}

/* "Mark as watched" button: shows the latest date once the title has been logged. */
function renderWatchedButton(item) {
  const verb = item.kind === 'game' ? 'played' : 'watched';
  const dates = watch.filter(w => w.item.key === item.key).map(w => w.date).sort();
  const last = dates[dates.length - 1];
  $('detail-watched').textContent = last
    ? `${verb[0].toUpperCase() + verb.slice(1)} ${prettyDate(last)}`
    : `Mark as ${verb}`;
  $('detail-watched').classList.toggle('done', Boolean(last));
}

function openWatchedSheet() {
  if (!detailItem) return;
  const game = detailItem.kind === 'game';
  $('watched-title').textContent = game ? 'When did you play it?' : 'When did you watch it?';
  $('watched-sub').textContent = detailItem.title;
  $('watched-date').max = todayKey;                            // no dates in the future
  $('watched-date').value = todayKey;
  $('watched-sheet').hidden = false;
}
function closeWatchedSheet() { $('watched-sheet').hidden = true; }

async function openDetail(item, { push = false } = {}) {
  if (push && detailItem) detailStack.push(detailItem);
  detailItem = item;
  renderDetail(item, null);
  $('detail').hidden = false;
  $('detail').scrollTop = 0;
  findGameCover(item);                                          // better box art for games
  try {
    const info = await loadInfo(item);
    if (info.backdrop) item.backdrop = info.backdrop;
    if (detailItem === item) renderDetail(item, info);          // skip if another title was opened meanwhile
  } catch (err) {
    if (detailItem === item) renderDetail(item, EMPTY_INFO);
  }
}

function closeDetail() {
  if (detailStack.length) { openDetail(detailStack.pop()); return; }   // came from "More like this": step back
  $('detail').hidden = true;
  detailItem = null;
}

$('detail-back').addEventListener('click', closeDetail);
$('detail-more').addEventListener('click', () => {
  const open = $('detail-synopsis').classList.toggle('clamp');
  $('detail-more').textContent = open ? 'Read more' : 'Show less';
});
$('detail-watched').addEventListener('click', openWatchedSheet);
$('watched-cancel').addEventListener('click', closeWatchedSheet);
$('watched-sheet').addEventListener('click', event => { if (event.target === event.currentTarget) closeWatchedSheet(); });
$('watched-form').addEventListener('submit', event => {
  event.preventDefault();
  const date = $('watched-date').value;
  if (!date || date > todayKey) return toast('Pick a date up to today');
  closeWatchedSheet();
  if (detailItem) logWatch(detailItem, date);
});

/* ==========================================================================
   6. EVENTS
   ========================================================================== */

/* One listener for every poster (data-open) and save button (data-save). */
document.addEventListener('click', event => {
  const open = event.target.closest('[data-open]');
  if (open) { const item = cache.get(open.dataset.open); if (item) openDetail(item, { push: Boolean(open.closest('#detail')) }); return; }
  const save = event.target.closest('[data-save]');
  if (save) handleSave(save.dataset.save);
});

$('auth-form').addEventListener('submit', event => { event.preventDefault(); signIn(); });
$('auth-signup').addEventListener('click', signUp);
$('sign-out').addEventListener('click', async () => {
  if (!confirm('Sign out of NEXUS?')) return;
  const { error } = await sb.auth.signOut();
  if (error) toast('Could not sign out: ' + error.message);
});

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
  syncKinds();
  loadHome();
  hideSplash();
  const games = new Map();                                    // saved/logged games get their better cover too
  [...lists.flatMap(l => l.items), ...watch.map(w => w.item)].forEach(i => { if (i.media === 'game') games.set(i.key, i); });
  games.forEach(findGameCover);
}

function showSignIn() {
  startedFor = null;
  lists = [];
  watch = [];
  openListId = null;
  pendingItem = null;
  detailItem = null;
  detailStack.length = 0;
  searchRun++;                                                 // drop any search still in flight
  // Close everything that could be left open on top of the sign-in screen.
  ['detail', 'list-view', 'save-sheet', 'watched-sheet', 'new-list'].forEach(id => { $(id).hidden = true; });
  $('tab-home').checked = true;
  input.value = '';
  showResultsUI(false);
  Object.assign(calendar, { year: now.getFullYear(), month: now.getMonth(), selected: todayKey });
  $('auth-password').value = '';
  authMessage('');
  /* The item lookup (cache) is NOT cleared: the Home rails keep their titles between
     sessions, and clearing it made every poster stop opening after signing back in. */
  refresh();
  renderCalendar();
  window.scrollTo(0, 0);
  $('auth').hidden = false;
  hideSplash();
}

/* Loading screen: fades out when the app is ready (or after 8 seconds, so a slow network can't trap you). */
function hideSplash() {
  const splash = $('splash');
  if (splash.classList.contains('done')) return;
  splash.classList.add('done');
  setTimeout(() => { splash.hidden = true; }, 400);
}
setTimeout(hideSplash, 8000);

if (PREVIEW) {
  $('sign-out').hidden = true;
  start({ id: 'preview' }).then(() => toast('Preview mode: sign-in is off and nothing is saved'));
} else if (!sb || !CFG.TMDB_TOKEN) {
  showSignIn();
  authMessage('Setup needed: add your TMDB and Supabase keys in config.js, then reload.');
} else {
  // Runs once at load and again on every sign-in / sign-out.
  // setTimeout avoids calling Supabase from inside its own callback.
  sb.auth.onAuthStateChange((event, session) => {
    setTimeout(() => (session ? start(session.user) : showSignIn()), 0);
  });
}
