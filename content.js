/**
 * content.js — Injected into every page.
 * Detects HTML presentations, manages audience mode, handles keyboard shortcuts.
 */

const LOG = 'HTMLpresenter:';

// ─── Slide selectors (priority order from SPEC.md) ─────────────────────────

const SLIDE_SELECTORS = [
  '.reveal .slides > section',  // Reveal.js
  'section.slide',              // HTML-CONVENTION.md standard
  'div.slide',
  'section[data-slide]',
  'body > section',             // broad fallback
];

// ─── In-memory state ────────────────────────────────────────────────────────

/** @type {Array<{element: Element, notes: string, index: number}>} */
let slides = [];
let presenterActive = false;
let currentSlideIndex = 0;
/** @type {HTMLStyleElement|null} */
let injectedStyleEl = null;

// ─── Slide detection ─────────────────────────────────────────────────────────

/**
 * Try each selector in order; return first set that yields 2+ elements.
 * @returns {Element[]}
 */
function findSlideElements() {
  for (const selector of SLIDE_SELECTORS) {
    const els = Array.from(document.querySelectorAll(selector));
    if (els.length >= 2) {
      console.log(`${LOG} found ${els.length} slides via selector: "${selector}"`);
      return els;
    }
  }
  return [];
}

/**
 * Try to load the JSON notes block from the page.
 * Returns a parsed object { "0": "...", "1": "..." } or null if absent/invalid.
 * @returns {Record<string, string>|null}
 */
function loadJsonNotes() {
  const scriptEl = document.querySelector('script[type="application/json"]#presenter-notes');
  if (!scriptEl) {
    console.log(`${LOG} no JSON notes block, using aside fallback`);
    return null;
  }
  try {
    const parsed = JSON.parse(scriptEl.textContent);
    const count = Object.keys(parsed).length;
    console.log(`${LOG} loaded notes from JSON block (${count} entries)`);
    return parsed;
  } catch (err) {
    console.error(`${LOG} JSON notes block parse error — falling back to aside:`, err.message);
    return null;
  }
}

/**
 * Extract the notes text for one slide, using the priority order:
 *   1. JSON block entry by index (if block was loaded)
 *   2. <aside class="notes"> inside the slide element
 *   3. data-notes attribute on the slide element
 *   4. Empty string
 *
 * The <aside class="notes"> is always removed from the DOM regardless of
 * which source wins, so the audience window never shows it.
 *
 * @param {Element} slideEl
 * @param {number} index
 * @param {Record<string, string>|null} jsonNotes
 * @returns {string}
 */
function extractAndRemoveNotes(slideEl, index, jsonNotes) {
  // Always strip <aside class="notes"> from DOM — even when JSON wins
  const aside = slideEl.querySelector('aside.notes');
  const asideText = aside ? aside.textContent.trim() : '';
  aside?.remove();

  // Priority 1: JSON block
  if (jsonNotes !== null) {
    const jsonEntry = jsonNotes[String(index)];
    if (jsonEntry?.trim()) return jsonEntry.trim();
  }

  // Priority 2: <aside class="notes"> (already extracted above)
  if (asideText) return asideText;

  // Priority 3: data-notes attribute
  const dataNotes = slideEl.getAttribute('data-notes');
  if (dataNotes?.trim()) return dataNotes.trim();

  // Priority 4: nothing
  return '';
}

/**
 * Run slide detection and populate the module-level `slides` array.
 */
function initSlides() {
  const elements = findSlideElements();
  if (elements.length === 0) {
    console.log(`${LOG} no slides detected on this page`);
    return;
  }

  const jsonNotes = loadJsonNotes();

  slides = elements.map((el, index) => {
    el.setAttribute('data-htmlpresenter-slide', index);
    const notes = extractAndRemoveNotes(el, index, jsonNotes);
    return { element: el, notes, index };
  });

  console.log(`${LOG} detected ${slides.length} slides`);
}

// ─── Audience mode CSS ────────────────────────────────────────────────────────

// Injected as a <style> tag only while presenter mode is active.
// Removed on exit so the page returns to its original state.
const AUDIENCE_CSS = `
  /* HTMLpresenter: hide all slides except the active one */
  [data-htmlpresenter-slide]:not([data-htmlpresenter-active]) {
    display: none !important;
  }

  /* HTMLpresenter: active slide fills the viewport */
  [data-htmlpresenter-active] {
    position: fixed !important;
    inset: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 100vw !important;
    height: 100vh !important;
  }

  /* HTMLpresenter: hide scrollbars in audience window */
  html, body {
    overflow: hidden !important;
  }

  /* HTMLpresenter: hide anything in <body> that isn't a slide or script/style */
  body > *:not([data-htmlpresenter-slide]):not(script):not(style) {
    display: none !important;
  }
`;

function injectAudienceCSS() {
  if (injectedStyleEl) return;
  injectedStyleEl = document.createElement('style');
  injectedStyleEl.id = 'htmlpresenter-audience-styles';
  injectedStyleEl.textContent = AUDIENCE_CSS;
  document.head.appendChild(injectedStyleEl);
}

function removeAudienceCSS() {
  injectedStyleEl?.remove();
  injectedStyleEl = null;
}

// ─── Audience mode control ────────────────────────────────────────────────────

/**
 * Activate audience view: inject CSS and mark the given slide as active.
 * @param {number} startIndex
 */
function enterAudienceMode(startIndex = 0) {
  presenterActive = true;
  injectAudienceCSS();
  showSlide(startIndex);
  console.log(`${LOG} audience mode active — showing slide ${startIndex + 1} / ${slides.length}`);
}

/**
 * Deactivate audience view: remove CSS and data attributes, restore page.
 */
function exitAudienceMode() {
  presenterActive = false;
  slides.forEach(({ element }) => {
    element.removeAttribute('data-htmlpresenter-active');
  });
  removeAudienceCSS();
  console.log(`${LOG} audience mode exited — page restored`);
}

/**
 * Update which slide is marked active (CSS hides all others automatically).
 * @param {number} index
 */
function showSlide(index) {
  if (index < 0 || index >= slides.length) return;
  currentSlideIndex = index;
  slides.forEach(({ element }, i) => {
    if (i === index) {
      element.setAttribute('data-htmlpresenter-active', '');
    } else {
      element.removeAttribute('data-htmlpresenter-active');
    }
  });
}

// ─── Start / stop presenter mode ──────────────────────────────────────────────

function startPresenterMode() {
  if (slides.length < 2) {
    console.log(`${LOG} cannot start — fewer than 2 slides detected`);
    return;
  }
  if (presenterActive) {
    console.log(`${LOG} presenter mode already active`);
    return;
  }

  const notesArray = slides.map(s => s.notes);

  // Collect presentation styles (all <style> tags joined) for iframe previews.
  // vw/vh units in presentation CSS map to the iframe viewport (1280×720), so
  // the previews look correct without any extra scaling tricks.
  const styles = Array.from(document.querySelectorAll('style'))
    .map(s => s.textContent)
    .join('\n');

  // Grab outerHTML of each slide NOW — notes have already been stripped from
  // the DOM by extractAndRemoveNotes(), so the HTML is already audience-clean.
  const slidesHTML = slides.map(s => s.element.outerHTML);

  chrome.runtime.sendMessage(
    { type: 'START_PRESENTER', slideCount: slides.length, notes: notesArray, styles, slidesHTML, url: window.location.href },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error(`${LOG} error contacting background:`, chrome.runtime.lastError.message);
        return;
      }
      if (response?.ok) {
        enterAudienceMode(0);
      } else {
        console.warn(`${LOG} background rejected START_PRESENTER:`, response?.reason);
      }
    }
  );
}

function stopPresenterMode() {
  chrome.runtime.sendMessage({ type: 'STOP_PRESENTER' }, () => {
    if (chrome.runtime.lastError) {
      // Background may be unavailable — still exit locally
    }
    exitAudienceMode();
  });
}

/**
 * Ask background to move to the next or previous slide.
 * Background owns boundary checking and broadcasts SLIDE_CHANGED to both windows.
 * @param {'next'|'prev'} direction
 */
function sendSlideChange(direction) {
  chrome.runtime.sendMessage({ type: 'CHANGE_SLIDE', direction }, (response) => {
    if (chrome.runtime.lastError) return;
    // Background already sent SLIDE_CHANGED broadcasts — nothing more to do here
    if (response?.reason === 'at_first') {
      console.log(`${LOG} already at first slide`);
    } else if (response?.reason === 'at_last') {
      console.log(`${LOG} already at last slide`);
    }
  });
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

/**
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
function isEditableTarget(event) {
  const tag = event.target?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || !!event.target?.isContentEditable;
}

document.addEventListener('keydown', (event) => {
  if (isEditableTarget(event)) return;

  if ((event.key === 'p' || event.key === 'P') && !presenterActive) {
    console.log(`${LOG} P key pressed — starting presenter mode`);
    startPresenterMode();
    return;
  }

  if (presenterActive) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      sendSlideChange('next');
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      sendSlideChange('prev');
      return;
    }
    if (event.key === 'Escape') {
      console.log(`${LOG} Escape pressed — stopping presenter mode`);
      stopPresenterMode();
    }
  }
});

// Right-click = next slide (audience window only, while presenter mode active)
document.addEventListener('contextmenu', (event) => {
  if (!presenterActive) return;
  event.preventDefault();
  sendSlideChange('next');
});

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {

    // Popup / background asks: is there a presentation here, and is it active?
    case 'GET_CONTENT_STATE':
      sendResponse({
        slidesDetected: slides.length >= 2,
        slideCount: slides.length,
        presenterActive,
        currentSlideIndex,
      });
      return false;

    // Popup triggered "Start Presenter" — relay through this content script
    case 'TRIGGER_START':
      startPresenterMode();
      sendResponse({ ok: true });
      return false;

    // Background tells us to enter audience mode (e.g. after window opens)
    case 'ENTER_AUDIENCE_MODE':
      enterAudienceMode(message.currentIndex ?? 0);
      sendResponse({ ok: true });
      return false;

    // Background tells us to exit (e.g. presenter window was closed)
    case 'EXIT_AUDIENCE_MODE':
      exitAudienceMode();
      sendResponse({ ok: true });
      return false;

    // Background relays a slide change from the presenter window
    case 'SLIDE_CHANGED':
      showSlide(message.index);
      sendResponse({ ok: true });
      return false;
  }
  return false;
});

// ─── Init ─────────────────────────────────────────────────────────────────────

console.log(`${LOG} content script loaded`, window.location.href);
initSlides();
