/**
 * popup.js — Popup window logic.
 * Queries background for session state, content.js for slide detection,
 * and routes Start/Stop Presenter actions.
 */

const LOG = 'HTMLpresenter:';

// ─── State rendering ──────────────────────────────────────────────────────────

/**
 * @param {'no-presentation'|'detected'|'active'} name
 */
function showState(name) {
  ['no-presentation', 'detected', 'active'].forEach((s) => {
    const el = document.getElementById(`state-${s}`);
    if (el) el.style.display = s === name ? '' : 'none';
  });
}

// ─── Init: determine which state to show ──────────────────────────────────────

async function init() {
  // 1. Check global background state first
  let bgState;
  try {
    bgState = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  } catch {
    // Service worker unavailable (rare) — fall through to no-presentation
    showState('no-presentation');
    return;
  }

  if (bgState?.presenterActive) {
    // Presenter mode is running
    const slideText = document.getElementById('active-slide-text');
    if (slideText) {
      slideText.textContent = `Slide ${bgState.currentSlideIndex + 1} / ${bgState.slideCount}`;
    }
    showState('active');
    return;
  }

  // 2. Presenter not active — ask the current tab's content.js for detection result
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    showState('no-presentation');
    return;
  }

  if (!tab?.id) {
    showState('no-presentation');
    return;
  }

  try {
    const contentState = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTENT_STATE' });
    if (contentState?.slidesDetected) {
      const countEl = document.getElementById('slide-count-text');
      if (countEl) countEl.textContent = `${contentState.slideCount} slides found`;
      showState('detected');
    } else {
      showState('no-presentation');
    }
  } catch {
    // Content script not injected on this page (e.g. chrome://, PDF, etc.)
    showState('no-presentation');
  }
}

// ─── Button handlers ──────────────────────────────────────────────────────────

document.getElementById('btn-start')?.addEventListener('click', async () => {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return;
  }
  if (!tab?.id) return;

  // Ask background to tell content.js to start — content.js already has slide data
  chrome.runtime.sendMessage({ type: 'TRIGGER_START_FROM_POPUP', tabId: tab.id });
  window.close();
});

document.getElementById('btn-stop')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_PRESENTER' });
  window.close();
});

// ─── Run ──────────────────────────────────────────────────────────────────────

console.log(`${LOG} popup loaded`);
init();
