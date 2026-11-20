/* ==========================================================================
   NEXUS — app.js
   index.html and style.css do the structure, tabs, detail screens and the
   expand/collapse of My List. This file has only two jobs:

     1. SAVED  – remember which titles are saved (localStorage) and mark them
     2. SEARCH – hide the Search rows that don't match what was typed
   ========================================================================== */
'use strict';

/* ---------- 1. SAVED ----------
   Buttons carry data-save="title-id". My List posters carry data-tile="title-id".
   A saved title gets the class "saved" on every one of those elements, and the
   CSS does the rest (button turns violet, poster appears in My List). */

const STORAGE_KEY = 'nexus_saved_v3';
const STARTER_LIST = ['interstellar', 'darkknight', 'dune', 'jjk', 'rdr2', 'ghost'];   // shown on first visit

let saved = loadSaved();

function loadSaved() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(stored) ? stored : [...STARTER_LIST];
  } catch (err) {
    return [...STARTER_LIST];            // storage blocked: use the starter list
  }
}

function persistSaved() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch (err) { /* ignore */ }
}

function showSaved() {
  document.querySelectorAll('[data-save], [data-tile]').forEach(el => {
    const id = el.dataset.save || el.dataset.tile;
    el.classList.toggle('saved', saved.includes(id));
  });
  document.getElementById('saved-count').textContent = saved.length + ' saved';
}

/* Tapping any save button adds or removes that title. */
document.addEventListener('click', event => {
  const button = event.target.closest('[data-save]');
  if (!button) return;
  const id = button.dataset.save;
  saved = saved.includes(id) ? saved.filter(x => x !== id) : [...saved, id];
  persistSaved();
  showSaved();
});

/* ---------- 2. SEARCH ----------
   Each row has data-search="title genre year type" (lower case).
   Typing hides the rows that do not contain the text. */

const input   = document.getElementById('search-input');
const clear   = document.getElementById('search-clear');
const heading = document.getElementById('search-heading');
const empty   = document.getElementById('search-empty');
const rows    = [...document.querySelectorAll('#search-results .row')];

function filterRows() {
  const text = input.value.trim().toLowerCase();
  let matches = 0;
  rows.forEach(row => {
    const hit = !text || row.dataset.search.includes(text);
    row.hidden = !hit;
    if (hit) matches++;
  });
  clear.hidden = !text;
  empty.hidden = matches > 0;
  heading.hidden = matches === 0;
  heading.textContent = text
    ? `${matches} ${matches === 1 ? 'result' : 'results'} for “${input.value.trim()}”`
    : 'All titles';
}

input.addEventListener('input', filterRows);
document.getElementById('search-form').addEventListener('submit', event => { event.preventDefault(); input.blur(); });
clear.addEventListener('click', () => { input.value = ''; filterRows(); input.focus(); });

showSaved();
