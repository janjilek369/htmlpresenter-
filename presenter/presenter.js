/**
 * presenter.js — Presenter window UI logic.
 */

const LOG = 'HTMLpresenter:';
console.log(`${LOG} presenter window loaded`);

// ─── State ────────────────────────────────────────────────────────────────────

let slideCount = 0;
let currentSlideIndex = 0;
/** @type {string[]} */
let notes = [];
/** CSS text collected from the presentation (all <style> tags joined) */
let presenterStyles = '';
/** outerHTML of each slide, post-notes-removal */
let slidesHTML = [];

/**
 * In-session edits: keyed by slide index, value is HTML string (innerHTML).
 * Persisted to chrome.storage.session for crash/accidental-close recovery.
 * @type {Record<number, string>}
 */
const sessionEdits = {};

/** Whether the notes panel is currently in edit mode. */
let editModeActive = false;

// ─── Session recovery ─────────────────────────────────────────────────────────

/** URL of the current presentation — used as part of the session storage key. */
let presentationUrl = '';

/** Sessions older than this are treated as stale and discarded (2 hours). */
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** @param {string} url @returns {string} */
function sessionKey(url) { return `session:${url}`; }

/** Debounce timer handle for throttled session writes. */
let _saveTimer = null;

/** Debounced — schedule a session write 2 s after the last change. */
function scheduleSessionSave() {
  if (!presentationUrl) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(flushSessionSave, 2000);
}

/** Write current slide index + all edits to chrome.storage.session. */
async function flushSessionSave() {
  if (!presentationUrl) return;
  try {
    await chrome.storage.session.set({
      [sessionKey(presentationUrl)]: {
        currentSlideIndex,
        editedNotes: { ...sessionEdits },
        slideCount,
        timestamp: Date.now(),
      },
    });
    console.log(`${LOG} session saved — slide ${currentSlideIndex + 1}`);
  } catch (err) {
    console.warn(`${LOG} session save failed:`, err);
  }
}

/** Remove session from chrome.storage.session immediately (intentional stop). */
async function clearSession() {
  if (!presentationUrl) return;
  clearTimeout(_saveTimer);
  try {
    await chrome.storage.session.remove(sessionKey(presentationUrl));
    console.log(`${LOG} session cleared`);
  } catch {}
}

/**
 * Check chrome.storage.session for a recoverable session.
 * Returns the session object if valid (exists and < SESSION_TTL_MS old), else null.
 * @param {string} url
 * @returns {Promise<{currentSlideIndex:number, editedNotes:Record<string,string>, slideCount:number, timestamp:number}|null>}
 */
async function checkSession(url) {
  if (!url) return null;
  try {
    const key = sessionKey(url);
    const result = await chrome.storage.session.get(key);
    const data = result[key];
    if (!data) return null;
    if (Date.now() - data.timestamp > SESSION_TTL_MS) {
      await chrome.storage.session.remove(key).catch(() => {});
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

// ─── Recovery dialog ──────────────────────────────────────────────────────────

/** Holds the session data while the recovery dialog is open. */
let pendingRecovery = null;

/**
 * Show the glassmorphism recovery dialog with session info.
 * @param {object} session
 */
function showRecoveryDialog(session) {
  pendingRecovery = session;

  const parts = [`Slide ${session.currentSlideIndex + 1} of ${session.slideCount}`];
  const editCount = Object.keys(session.editedNotes ?? {}).length;
  if (editCount > 0) {
    parts.push(`${editCount} edited note${editCount > 1 ? 's' : ''}`);
  }
  document.getElementById('recovery-meta').textContent = parts.join(' · ');
  document.getElementById('recovery-overlay').hidden = false;
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const slideCounterEl       = document.getElementById('slide-counter');
const notesPanelEl         = document.getElementById('notes-panel');
const formatToolbarEl      = document.getElementById('format-toolbar');
const recoveryOverlayEl    = document.getElementById('recovery-overlay');
const timerDisplayEl       = document.getElementById('timer-display');
const timerEl              = document.getElementById('timer');
const btnTimerToggle       = document.getElementById('btn-timer-toggle');
const thumbCurrentWrapper  = document.getElementById('thumb-current-wrapper');
const thumbNextWrapper     = document.getElementById('thumb-next-wrapper');
const thumbCurrentIframe   = document.getElementById('thumb-current-iframe');
const thumbNextIframe      = document.getElementById('thumb-next-iframe');
const thumbNextEnd         = document.getElementById('thumb-next-end');

// ─── Recovery dialog button handlers ─────────────────────────────────────────

document.getElementById('btn-recovery-continue').addEventListener('click', () => {
  recoveryOverlayEl.hidden = true;
  const session = pendingRecovery;
  pendingRecovery = null;
  if (!session) return;

  // Restore slide index and any edited notes from the session
  currentSlideIndex = session.currentSlideIndex;
  Object.assign(sessionEdits, session.editedNotes ?? {});

  renderCounter(currentSlideIndex);
  renderNotes(currentSlideIndex);
  renderThumbnails(currentSlideIndex);

  // Tell background (and via it, the audience tab) to jump to recovered slide
  chrome.runtime.sendMessage({ type: 'RESUME_AT', index: currentSlideIndex }, () => {
    if (chrome.runtime.lastError) {
      console.warn(`${LOG} RESUME_AT failed:`, chrome.runtime.lastError.message);
    }
  });

  console.log(`${LOG} session recovered — slide ${currentSlideIndex + 1}`);
});

document.getElementById('btn-recovery-fresh').addEventListener('click', async () => {
  recoveryOverlayEl.hidden = true;
  pendingRecovery = null;
  await clearSession();
  // currentSlideIndex is already 0, notes already rendered with original data
  console.log(`${LOG} session discarded — starting fresh`);
});

// ─── Notes panel ─────────────────────────────────────────────────────────────

/**
 * Sanitize an HTML string to only allowed formatting tags, stripping
 * all attributes and any tags not on the allowlist (script, iframe, etc.).
 * Uses DOMParser so the browser does the heavy lifting — no regex hacks.
 * @param {string} html  Raw HTML from JSON notes or live edit session.
 * @returns {string}     Safe HTML ready for innerHTML assignment.
 */
function sanitizeNotes(html) {
  const ALLOWED = ['STRONG', 'B', 'EM', 'I', 'U', 'BR', 'P', 'UL', 'OL', 'LI', 'SPAN'];
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstChild;

  function walk(node) {
    // Iterate a static copy — the live NodeList shifts as we mutate
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue; // keep text nodes as-is
      if (!ALLOWED.includes(child.tagName)) {
        // Unwrap: move children out, then remove the disallowed tag itself
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
      } else {
        // Strip every attribute (onclick, style, onerror …)
        while (child.attributes.length > 0) {
          child.removeAttribute(child.attributes[0].name);
        }
        walk(child);
      }
    }
  }

  walk(root);
  return root.innerHTML;
}

/**
 * Render the notes for the given slide index.
 * Checks sessionEdits first (formatted HTML), then falls back to original notes.
 * All HTML is passed through sanitizeNotes before being set as innerHTML.
 * @param {number} index
 */
function renderNotes(index) {
  if (index in sessionEdits) {
    // Live-edited version — already HTML from contenteditable; sanitize for safety
    const safe = sanitizeNotes(sessionEdits[index]);
    notesPanelEl.innerHTML = safe;
    notesPanelEl.classList.toggle('notes-panel--empty', safe.trim() === '');
  } else {
    const text = notes[index] ?? '';
    if (text) {
      // Original notes may contain formatting tags from the JSON block
      notesPanelEl.innerHTML = sanitizeNotes(text);
      notesPanelEl.classList.remove('notes-panel--empty');
    } else {
      notesPanelEl.textContent = 'No notes for this slide.';
      notesPanelEl.classList.add('notes-panel--empty');
    }
  }
  notesPanelEl.classList.add('notes-panel--transitioning');
  notesPanelEl.addEventListener('animationend', () => {
    notesPanelEl.classList.remove('notes-panel--transitioning');
  }, { once: true });
}

/**
 * Update slide counter display.
 * @param {number} index  0-based
 */
function renderCounter(index) {
  if (slideCount === 0) {
    slideCounterEl.textContent = 'Slide — / —';
  } else {
    slideCounterEl.textContent = `Slide ${index + 1} / ${slideCount}`;
  }
}

// ─── Timer ────────────────────────────────────────────────────────────────────

let timerSeconds = 0;
let timerRunning = true;
let timerInterval = null;

function formatTime(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

function startTimer() {
  if (timerInterval) return;
  timerInterval = setInterval(() => {
    timerSeconds++;
    timerDisplayEl.textContent = formatTime(timerSeconds);
  }, 1000);
  timerRunning = true;
  syncTimerUI();
}

function pauseTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  timerRunning = false;
  syncTimerUI();
}

function resetTimer() {
  const wasRunning = timerRunning;
  pauseTimer();
  timerSeconds = 0;
  timerDisplayEl.textContent = '00:00';
  if (wasRunning) startTimer();
}

function syncTimerUI() {
  if (timerRunning) {
    timerEl.classList.add('header__timer--running');
    timerEl.classList.remove('header__timer--paused');
    btnTimerToggle.textContent = '⏸ Pause';
  } else {
    timerEl.classList.remove('header__timer--running');
    timerEl.classList.add('header__timer--paused');
    btnTimerToggle.textContent = '▶ Resume';
  }
}

// Timer button: click = pause/play, long-press 1s = reset
let longPressTimer = null;

btnTimerToggle.addEventListener('mousedown', () => {
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    resetTimer();
  }, 1000);
});

btnTimerToggle.addEventListener('mouseup', () => {
  if (!longPressTimer) return; // Was a long press — already handled
  clearTimeout(longPressTimer);
  longPressTimer = null;
  timerRunning ? pauseTimer() : startTimer();
});

btnTimerToggle.addEventListener('mouseleave', () => {
  clearTimeout(longPressTimer);
  longPressTimer = null;
});

// ─── Font size ────────────────────────────────────────────────────────────────

const FONT_MIN = 16;
const FONT_MAX = 48;
const FONT_STEP = 2;
let currentFontSize = 24;

function setFontSize(size) {
  currentFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, size));
  document.documentElement.style.setProperty('--notes-size', `${currentFontSize}px`);
}

document.getElementById('btn-font-decrease').addEventListener('click', () => setFontSize(currentFontSize - FONT_STEP));
document.getElementById('btn-font-increase').addEventListener('click', () => setFontSize(currentFontSize + FONT_STEP));

// ─── Thumbnails — iframe previews ────────────────────────────────────────────

/**
 * Build a self-contained srcdoc HTML string for a single slide.
 * Forces the slide to fill a 1280×720 viewport so CSS vw/vh units
 * render correctly at the presentation's intended scale.
 * @param {number} index
 * @returns {string|null}  null when index is out of range
 */
function buildPreview(index) {
  if (index < 0 || index >= slidesHTML.length) return null;

  // Override rules that would hide non-first slides or interfere with display.
  const overrides = `
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0; overflow: hidden;
      width: 1280px; height: 720px;
    }
    section.slide, div.slide {
      display: flex !important;
      width: 1280px !important; height: 720px !important;
      position: static !important;
    }
    aside.notes { display: none !important; }
  `;

  return (
    `<!DOCTYPE html><html><head><meta charset="UTF-8">` +
    `<style>${presenterStyles}\n${overrides}</style>` +
    `</head><body>${slidesHTML[index]}</body></html>`
  );
}

/**
 * Scale an iframe (1280×720) so the FULL slide fits inside its wrapper.
 * Uses "contain" logic: scale = min(wrapperW/1280, wrapperH/720).
 * Centers the result in case rounding leaves a small gap.
 *
 * @param {HTMLElement} wrapper
 * @param {HTMLIFrameElement} iframe
 */
function scaleIframe(wrapper, iframe) {
  if (!wrapper || !iframe) return;
  const { width, height } = wrapper.getBoundingClientRect();
  if (width === 0 || height === 0) return;

  const scale   = Math.min(width / 1280, height / 720);
  const offsetX = (width  - 1280 * scale) / 2;
  const offsetY = (height - 720  * scale) / 2;

  iframe.style.transformOrigin = 'top left';
  iframe.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}

/**
 * Rebuild both thumbnail iframes for the given slide index.
 * @param {number} index  0-based current slide index
 */
function renderThumbnails(index) {
  // ── Current slide ──────────────────────────────────────────────────────────
  const currentSrcdoc = buildPreview(index);
  if (thumbCurrentIframe && currentSrcdoc !== null) {
    thumbCurrentIframe.srcdoc = currentSrcdoc;
  }

  // ── Next slide (or end-of-presentation placeholder) ───────────────────────
  const nextSrcdoc = buildPreview(index + 1);
  if (thumbNextIframe && thumbNextEnd) {
    if (nextSrcdoc !== null) {
      thumbNextIframe.srcdoc = nextSrcdoc;
      thumbNextIframe.style.display = '';
      thumbNextEnd.style.display = 'none';
    } else {
      // No next slide — show placeholder, hide iframe
      thumbNextIframe.srcdoc = '';
      thumbNextIframe.style.display = 'none';
      thumbNextEnd.style.display = 'flex';
    }
  }

  // Re-apply scale after content update (layout may shift slightly)
  scaleIframe(thumbCurrentWrapper, thumbCurrentIframe);
  scaleIframe(thumbNextWrapper, thumbNextIframe);
}

// Keep thumbnails properly scaled when the presenter window is resized.
const thumbnailResizeObserver = new ResizeObserver(() => {
  scaleIframe(thumbCurrentWrapper, thumbCurrentIframe);
  scaleIframe(thumbNextWrapper, thumbNextIframe);
});
if (thumbCurrentWrapper) thumbnailResizeObserver.observe(thumbCurrentWrapper);
if (thumbNextWrapper)    thumbnailResizeObserver.observe(thumbNextWrapper);

// ─── Navigation ───────────────────────────────────────────────────────────────

/**
 * Ask background to change slide. Background owns boundary checks and
 * broadcasts SLIDE_CHANGED to both windows.
 * @param {'next'|'prev'} direction
 */
function sendSlideChange(direction) {
  chrome.runtime.sendMessage({ type: 'CHANGE_SLIDE', direction }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.reason === 'at_first') {
      console.log(`${LOG} already at first slide`);
    } else if (response?.reason === 'at_last') {
      console.log(`${LOG} already at last slide`);
    }
  });
}

// ─── Edit mode ────────────────────────────────────────────────────────────────

const btnEdit = document.getElementById('btn-edit');

/**
 * Save whatever is currently in the notes panel to sessionEdits.
 * Strips the empty-placeholder text so we don't accidentally persist it.
 */
function saveCurrentEdit() {
  const html = notesPanelEl.innerHTML;
  // If the panel still shows the "No notes" placeholder, don't save it
  if (!notesPanelEl.classList.contains('notes-panel--empty')) {
    sessionEdits[currentSlideIndex] = html;
  }
}

/**
 * Enter edit mode: show toolbar, make notes panel contenteditable.
 */
function enterEditMode() {
  if (editModeActive) return;
  editModeActive = true;

  // Clear empty-state text before editing
  if (notesPanelEl.classList.contains('notes-panel--empty')) {
    notesPanelEl.textContent = '';
    notesPanelEl.classList.remove('notes-panel--empty');
  }

  notesPanelEl.contentEditable = 'true';
  formatToolbarEl.hidden = false;
  btnEdit.textContent = 'Editing…';
  btnEdit.style.color = 'var(--accent)';

  // Focus at end of content
  notesPanelEl.focus();
  const range = document.createRange();
  range.selectNodeContents(notesPanelEl);
  range.collapse(false);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

/**
 * Exit edit mode: save edits, hide toolbar, make notes panel read-only.
 * @param {'save'|'cancel'} action
 */
function exitEditMode(action) {
  if (!editModeActive) return;
  editModeActive = false;

  if (action === 'save') {
    saveCurrentEdit();
    // Persist edit to session storage so it survives an accidental window close
    scheduleSessionSave();
  } else {
    // Cancel: restore original content without saving
    renderNotes(currentSlideIndex);
  }

  notesPanelEl.contentEditable = 'false';
  formatToolbarEl.hidden = true;
  btnEdit.textContent = 'Edit';
  btnEdit.style.color = '';
}

btnEdit.addEventListener('click', () => {
  editModeActive ? exitEditMode('save') : enterEditMode();
});

// Toolbar buttons
document.getElementById('fmt-bold').addEventListener('click', () => {
  document.execCommand('bold');
  notesPanelEl.focus();
});

document.getElementById('fmt-italic').addEventListener('click', () => {
  document.execCommand('italic');
  notesPanelEl.focus();
});

document.getElementById('fmt-done').addEventListener('click', () => {
  exitEditMode('save');
});

// Keyboard shortcuts inside the notes panel while editing
notesPanelEl.addEventListener('keydown', (event) => {
  if (!editModeActive) return;

  const mod = event.metaKey || event.ctrlKey;

  if (mod && event.key === 'b') {
    event.preventDefault();
    document.execCommand('bold');
    return;
  }
  if (mod && event.key === 'i') {
    event.preventDefault();
    document.execCommand('italic');
    return;
  }
  // Override browser's default Enter behaviour (inserts <div> or wraps in <div><br></div>
  // depending on the browser, causing the first newline to silently disappear after
  // sanitizeNotes strips div tags). A plain <br> is in the allowlist and round-trips
  // correctly through save → sanitize → render.
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    document.execCommand('insertHTML', false, '<br>');
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    exitEditMode('cancel');
  }
});

// ─── Theme toggle ─────────────────────────────────────────────────────────────

const THEME_STORAGE_KEY = 'presenter-theme';

/** Phosphor "sun" icon — shown when dark mode is active (click → go light). */
const ICON_SUN = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm72,88a64,64,0,1,1-64-64A64.07,64.07,0,0,1,192,128Zm-16,0a48,48,0,1,0-48,48A48.05,48.05,0,0,0,176,128ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z"/></svg>`;

/** Phosphor "moon" icon — shown when light mode is active (click → go dark). */
const ICON_MOON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.91,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.52-20.88,104.84,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23ZM188.9,190.34A88,88,0,0,1,65.66,67.11a89,89,0,0,1,31.4-26A106,106,0,0,0,96,56,104.11,104.11,0,0,0,200,160a106,106,0,0,0,14.92-1.06A89,89,0,0,1,188.9,190.34Z"/></svg>`;

/** Currently active theme. Kept in sync with chrome.storage.local. */
let currentTheme = 'dark';

/**
 * Apply a theme by setting / removing `data-theme` on <html>
 * and updating the toggle button icon + tooltip.
 * @param {'dark'|'light'} theme
 */
function applyTheme(theme) {
  currentTheme = theme;
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  const btn = document.getElementById('btn-theme');
  if (theme === 'dark') {
    btn.innerHTML = ICON_SUN;
    btn.title = 'Switch to light mode';
    btn.setAttribute('aria-label', 'Switch to light mode');
  } else {
    btn.innerHTML = ICON_MOON;
    btn.title = 'Switch to dark mode';
    btn.setAttribute('aria-label', 'Switch to dark mode');
  }
}

/**
 * Load saved theme from chrome.storage.local and apply it.
 * Falls back to 'dark' if no preference is stored.
 */
async function loadTheme() {
  try {
    const result = await chrome.storage.local.get(THEME_STORAGE_KEY);
    applyTheme(result[THEME_STORAGE_KEY] === 'light' ? 'light' : 'dark');
  } catch {
    applyTheme('dark');
  }
}

document.getElementById('btn-theme').addEventListener('click', async () => {
  const next = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: next });
  } catch (err) {
    console.warn(`${LOG} theme save failed:`, err);
  }
});

// ─── Keyboard shortcuts in presenter window ───────────────────────────────────

document.addEventListener('keydown', (event) => {
  // Don't intercept keys when user is editing notes
  if (event.target?.isContentEditable) return;

  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      event.preventDefault();
      sendSlideChange('next');
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      event.preventDefault();
      sendSlideChange('prev');
      break;
    case 'Escape':
      chrome.runtime.sendMessage({ type: 'STOP_PRESENTER' });
      break;
  }
});

// ─── Background messages ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'SLIDE_CHANGED':
      // Auto-save any in-progress edits before switching slides
      if (editModeActive) exitEditMode('save');
      currentSlideIndex = message.index;
      renderCounter(currentSlideIndex);
      renderNotes(currentSlideIndex);
      renderThumbnails(currentSlideIndex);
      // Persist new position (and any edits saved above) to session storage
      scheduleSessionSave();
      break;
  }
});

// ─── Init: request state from background ─────────────────────────────────────

async function initFromBackground() {
  try {
    const data = await chrome.runtime.sendMessage({ type: 'PRESENTER_READY' });
    if (!data) {
      console.warn(`${LOG} no state received from background`);
      return;
    }
    slideCount        = data.slideCount;
    currentSlideIndex = data.currentSlideIndex;
    notes             = data.notes ?? [];
    presenterStyles   = data.styles ?? '';
    slidesHTML        = data.slidesHTML ?? [];
    presentationUrl   = data.url ?? '';

    // Render the original state first (visible behind the dialog if shown)
    renderCounter(currentSlideIndex);
    renderNotes(currentSlideIndex);
    renderThumbnails(currentSlideIndex);

    // Check for a recoverable session (< 2 h old) for this presentation URL
    const session = await checkSession(presentationUrl);
    if (session) {
      console.log(`${LOG} recoverable session found — slide ${session.currentSlideIndex + 1}`);
      showRecoveryDialog(session);
    }

    console.log(`${LOG} presenter initialized — ${slideCount} slides`);
  } catch (err) {
    console.error(`${LOG} error initializing from background:`, err);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

startTimer();
applyTheme('dark');  // set default icon immediately so button is never empty
loadTheme();         // overrides with stored preference (async, fast)
initFromBackground();
