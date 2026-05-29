/**
 * background.js — Service worker.
 * Single source of truth for presenter session state.
 * Routes messages between audience tab (content.js) and presenter window (presenter.js).
 */

const LOG = 'HTMLpresenter:';

// ─── Session state ────────────────────────────────────────────────────────────

/**
 * @type {{
 *   presenterActive: boolean,
 *   audienceTabId: number|null,
 *   presenterWindowId: number|null,
 *   currentSlideIndex: number,
 *   slideCount: number,
 *   notes: string[],
 * }}
 */
const state = {
  presenterActive: false,
  audienceTabId: null,
  audienceWindowId: null,
  presenterWindowId: null,
  presenterTabId: null,
  currentSlideIndex: 0,
  slideCount: 0,
  notes: [],
  styles: '',
  slidesHTML: [],
  /** URL of the HTML presentation (used as session storage key). */
  presentationUrl: '',
  /**
   * True when presenter mode was stopped intentionally via Esc / STOP_PRESENTER.
   * False when the presenter window was closed with the × button (accidental).
   * Background uses this flag in windows.onRemoved to decide whether to
   * preserve the session for recovery.
   */
  intentionalStop: false,
};

// ─── Window management ────────────────────────────────────────────────────────

/**
 * Open the presenter window in the foreground.
 * The presenter window is brought to the front immediately; the audience
 * window is NOT re-focused (keyboard events work in both windows regardless
 * of focus, so this is unnecessary and was hiding the presenter window).
 * @returns {Promise<void>}
 */
async function openPresenterWindow() {
  const audienceTab = await chrome.tabs.get(state.audienceTabId);
  state.audienceWindowId = audienceTab.windowId;

  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('presenter/presenter.html'),
    type: 'popup',
    width: 1200,
    height: 800,
    focused: true,        // bring to front on creation
  });

  state.presenterWindowId = win.id;
  state.presenterTabId = win.tabs?.[0]?.id ?? null;
  console.log(`${LOG} presenter window opened (windowId=${win.id}, tabId=${state.presenterTabId})`);

  // Explicitly assert focus + draw Dock/taskbar attention after creation.
  // On macOS, chrome.windows.create with focused:true is sometimes
  // insufficient when another window steals focus during the popup open
  // animation, so we do a follow-up update as well.
  try {
    await chrome.windows.update(win.id, { focused: true, drawAttention: true });
  } catch {
    // Non-critical — window may have been closed immediately
  }

  // macOS guard: if the OS re-raises the audience window during the popup
  // open animation, one extra focused:true push after a short delay fixes it.
  setTimeout(() => {
    chrome.windows.update(win.id, { focused: true }).catch(() => {});
  }, 80);
}

/**
 * Send SLIDE_CHANGED to both the audience tab and the presenter window tab.
 * Fire-and-forget — the response doesn't need to block anything.
 * @param {number} newIndex
 */
async function broadcastSlideChange(newIndex) {
  const payload = { type: 'SLIDE_CHANGED', index: newIndex };

  if (state.audienceTabId !== null) {
    try { await chrome.tabs.sendMessage(state.audienceTabId, payload); } catch {}
  }

  if (state.presenterTabId !== null) {
    try { await chrome.tabs.sendMessage(state.presenterTabId, payload); } catch {}
  }
}

/**
 * Tear down the presenter session:
 * - Close the presenter window (if still open)
 * - Tell the audience tab to exit audience mode
 * - Reset state
 */
async function closePresenterMode() {
  // Null out presenterWindowId BEFORE calling chrome.windows.remove so that
  // the resulting windows.onRemoved event doesn't match and re-enter cleanup.
  const winId = state.presenterWindowId;
  state.presenterWindowId = null;

  if (winId !== null) {
    try {
      await chrome.windows.remove(winId);
    } catch {
      // Already closed — that's fine
    }
  }

  // Tell audience tab to restore itself
  if (state.audienceTabId !== null) {
    try {
      await chrome.tabs.sendMessage(state.audienceTabId, { type: 'EXIT_AUDIENCE_MODE' });
    } catch {
      // Tab may have been closed
    }
  }

  // Reset all state
  state.presenterActive = false;
  state.audienceTabId = null;
  state.audienceWindowId = null;
  state.presenterTabId = null;
  state.currentSlideIndex = 0;
  state.slideCount = 0;
  state.notes = [];
  state.styles = '';
  state.slidesHTML = [];
  state.presentationUrl = '';
  state.intentionalStop = false;
  console.log(`${LOG} presenter mode closed`);
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(`${LOG} [bg] message:`, message.type);

  switch (message.type) {

    // ── Content script: user pressed P (or popup triggered start) ──────────
    case 'START_PRESENTER': {
      if (state.presenterActive) {
        sendResponse({ ok: false, reason: 'already_active' });
        return false;
      }

      state.presenterActive = true;
      state.audienceTabId = sender.tab.id;
      state.currentSlideIndex = 0;
      state.slideCount = message.slideCount;
      state.notes = message.notes;
      state.styles = message.styles ?? '';
      state.slidesHTML = message.slidesHTML ?? [];
      state.presentationUrl = message.url ?? '';
      state.intentionalStop = false;

      openPresenterWindow()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.error(`${LOG} window create failed:`, err);
          state.presenterActive = false;
          state.audienceTabId = null;
          state.presentationUrl = '';
          sendResponse({ ok: false, reason: 'window_create_failed' });
        });
      return true;
    }

    // ── Popup "Start Presenter" button — route to content script ───────────
    case 'TRIGGER_START_FROM_POPUP': {
      chrome.tabs.sendMessage(message.tabId, { type: 'TRIGGER_START' }, (response) => {
        sendResponse(response ?? { ok: false, reason: 'no_response' });
      });
      return true;
    }

    // ── Content script or presenter window: intentional stop ──────────────
    case 'STOP_PRESENTER': {
      // Mark intentional so windows.onRemoved doesn't treat this as accidental.
      state.intentionalStop = true;
      // Delete the session — user is done on purpose.
      if (state.presentationUrl) {
        chrome.storage.session
          .remove(`session:${state.presentationUrl}`)
          .catch(() => {});
      }
      closePresenterMode()
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    // ── Navigation: content.js or presenter.js requested a slide change ───
    case 'CHANGE_SLIDE': {
      if (!state.presenterActive) {
        sendResponse({ ok: false, reason: 'not_active' });
        return false;
      }

      const { direction } = message;
      const candidate =
        direction === 'next'
          ? state.currentSlideIndex + 1
          : state.currentSlideIndex - 1;

      if (candidate < 0) {
        console.log(`${LOG} already at first slide`);
        sendResponse({ ok: false, reason: 'at_first' });
        return false;
      }
      if (candidate >= state.slideCount) {
        console.log(`${LOG} already at last slide`);
        sendResponse({ ok: false, reason: 'at_last' });
        return false;
      }

      state.currentSlideIndex = candidate;
      // Broadcast to both windows — fire-and-forget, no need to await
      broadcastSlideChange(candidate);
      sendResponse({ ok: true, newIndex: candidate });
      return false;
    }

    // ── Popup: what is the current state? ──────────────────────────────────
    case 'GET_STATE': {
      sendResponse({ ...state });
      return false;
    }

    // ── Presenter window has loaded — give it the initial data ─────────────
    case 'PRESENTER_READY': {
      sendResponse({
        slideCount: state.slideCount,
        currentSlideIndex: state.currentSlideIndex,
        currentNotes: state.notes[state.currentSlideIndex] ?? '',
        notes: state.notes,
        styles: state.styles,
        slidesHTML: state.slidesHTML,
        url: state.presentationUrl,
      });
      return false;
    }

    // ── Presenter recovered a session — sync audience to the right slide ────
    case 'RESUME_AT': {
      if (!state.presenterActive) {
        sendResponse({ ok: false });
        return false;
      }
      state.currentSlideIndex = message.index;
      // Tell only the audience tab — presenter already has the correct state.
      if (state.audienceTabId !== null) {
        chrome.tabs.sendMessage(
          state.audienceTabId,
          { type: 'SLIDE_CHANGED', index: message.index }
        ).catch(() => {});
      }
      sendResponse({ ok: true });
      return false;
    }
  }

  return false;
});

// ─── Cleanup listeners ────────────────────────────────────────────────────────

// Presenter window removed (× button OR result of intentional chrome.windows.remove).
// Because closePresenterMode() nulls presenterWindowId BEFORE calling remove(),
// the intentional-stop path produces presenterWindowId === null here → no match.
// Only the × button (accidental) path reaches this with a live windowId.
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId !== state.presenterWindowId) return;

  console.log(`${LOG} presenter window closed by × — session preserved for recovery`);
  // Null out so closePresenterMode skips chrome.windows.remove (already gone).
  state.presenterWindowId = null;
  // Do NOT delete the session — it survives for the next P press.
  closePresenterMode();
});

// Audience tab closed while presenter mode is active
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.audienceTabId) {
    console.log(`${LOG} audience tab closed — ending presenter mode`);
    closePresenterMode();
  }
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`${LOG} service worker installed (${details.reason})`);
});

chrome.runtime.onStartup.addListener(() => {
  console.log(`${LOG} service worker started`);
});
