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

/**
 * True while a START_PRESENTER request is opening its window. In-memory only
 * (a worker restart mid-open is harmless) — guards against a second START
 * racing the first before presenterWindowId is known.
 */
let startingPresenter = false;

// ─── State persistence (MV3 service worker survival) ─────────────────────────
//
// Chrome terminates an idle MV3 service worker after ~30 s. Without
// persistence the in-memory `state` object is lost, the next CHANGE_SLIDE
// wakes a fresh worker with presenterActive=false, and navigation silently
// stops working until the user refreshes the presentation. To survive
// termination, every state mutation is mirrored to chrome.storage.session
// and restored before any message/event is handled.

const BG_STATE_KEY = 'bg-state';

/** Mirror the current state to chrome.storage.session (fire-and-forget). */
async function persistState() {
  try {
    await chrome.storage.session.set({ [BG_STATE_KEY]: state });
  } catch (err) {
    // Most likely the quota (large slidesHTML, e.g. inline base64 images).
    // Persist a light copy without the heavy fields — navigation still
    // survives a worker restart; slide previews and notes live in the
    // presenter window's own memory, which a worker restart doesn't touch.
    try {
      await chrome.storage.session.set({
        [BG_STATE_KEY]: { ...state, slidesHTML: [], styles: '', notes: [] },
      });
      console.warn(`${LOG} full state too large — persisted light state (${err?.message})`);
    } catch (err2) {
      console.warn(`${LOG} state persist failed:`, err2);
    }
  }
}

/** Restore state from chrome.storage.session after a service worker restart. */
async function restoreState() {
  try {
    const result = await chrome.storage.session.get(BG_STATE_KEY);
    if (result[BG_STATE_KEY]) {
      Object.assign(state, result[BG_STATE_KEY]);
      if (state.presenterActive) {
        console.log(
          `${LOG} state restored after service worker restart — slide ${state.currentSlideIndex + 1}/${state.slideCount}`
        );
      }
    }
  } catch (err) {
    console.warn(`${LOG} state restore failed:`, err);
  }
}

/**
 * Resolved once the persisted state has been loaded. Every message and
 * cleanup listener awaits this before touching `state`.
 */
const stateReady = restoreState();

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
  persistState();
  console.log(`${LOG} presenter mode closed`);
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Always return true (async response): state must be restored from
  // chrome.storage.session first in case the service worker just restarted.
  handleMessage(message, sender, sendResponse);
  return true;
});

/**
 * Process one runtime message after persisted state has been restored.
 * @param {object} message
 * @param {chrome.runtime.MessageSender} sender
 * @param {(response?: object) => void} sendResponse
 */
async function handleMessage(message, sender, sendResponse) {
  await stateReady;
  console.log(`${LOG} [bg] message:`, message.type);

  switch (message.type) {

    // ── Content script: user pressed P (or popup triggered start) ──────────
    case 'START_PRESENTER': {
      // A second START can arrive while the first is still opening its window
      // (held-down P auto-repeats, double-press). At that moment
      // presenterWindowId is still null, so the stale-state check below would
      // wrongly conclude the window vanished and open a SECOND presenter.
      // The in-memory flag closes that race — within one worker lifetime only
      // one START can be in flight.
      if (startingPresenter) {
        sendResponse({ ok: false, reason: 'already_active' });
        return;
      }

      if (state.presenterActive) {
        // Restored state can be stale: the presenter window may have vanished
        // while the worker was dead (lost onRemoved event). Verify it still
        // exists before refusing to start — otherwise P would be dead forever.
        let windowAlive = false;
        if (state.presenterWindowId !== null) {
          try {
            await chrome.windows.get(state.presenterWindowId);
            windowAlive = true;
          } catch {
            // Window is gone — fall through to cleanup + fresh start
          }
        }
        if (windowAlive) {
          sendResponse({ ok: false, reason: 'already_active' });
          return;
        }
        console.log(`${LOG} stale active state detected — resetting before start`);
        await closePresenterMode();
      }

      startingPresenter = true;
      state.presenterActive = true;
      state.audienceTabId = sender.tab.id;
      state.currentSlideIndex = 0;
      state.slideCount = message.slideCount;
      state.notes = message.notes;
      state.styles = message.styles ?? '';
      state.slidesHTML = message.slidesHTML ?? [];
      state.presentationUrl = message.url ?? '';
      state.intentionalStop = false;

      try {
        await openPresenterWindow();
        persistState();
        sendResponse({ ok: true });
      } catch (err) {
        console.error(`${LOG} window create failed:`, err);
        state.presenterActive = false;
        state.audienceTabId = null;
        state.presentationUrl = '';
        persistState();
        sendResponse({ ok: false, reason: 'window_create_failed' });
      } finally {
        startingPresenter = false;
      }
      return;
    }

    // ── Popup "Start Presenter" button — route to content script ───────────
    case 'TRIGGER_START_FROM_POPUP': {
      chrome.tabs.sendMessage(message.tabId, { type: 'TRIGGER_START' }, (response) => {
        sendResponse(response ?? { ok: false, reason: 'no_response' });
      });
      return;
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
      try {
        await closePresenterMode();
        sendResponse({ ok: true });
      } catch {
        sendResponse({ ok: false });
      }
      return;
    }

    // ── Navigation: content.js or presenter.js requested a slide change ───
    case 'CHANGE_SLIDE': {
      if (!state.presenterActive) {
        sendResponse({ ok: false, reason: 'not_active' });
        return;
      }

      const { direction } = message;
      const candidate =
        direction === 'next'
          ? state.currentSlideIndex + 1
          : state.currentSlideIndex - 1;

      if (candidate < 0) {
        console.log(`${LOG} already at first slide`);
        sendResponse({ ok: false, reason: 'at_first' });
        return;
      }
      if (candidate >= state.slideCount) {
        console.log(`${LOG} already at last slide`);
        sendResponse({ ok: false, reason: 'at_last' });
        return;
      }

      state.currentSlideIndex = candidate;
      persistState();
      // Broadcast to both windows — fire-and-forget, no need to await
      broadcastSlideChange(candidate);
      sendResponse({ ok: true, newIndex: candidate });
      return;
    }

    // ── Popup: what is the current state? ──────────────────────────────────
    case 'GET_STATE': {
      sendResponse({ ...state });
      return;
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
      return;
    }

    // ── Presenter recovered a session — sync audience to the right slide ────
    case 'RESUME_AT': {
      if (!state.presenterActive) {
        sendResponse({ ok: false });
        return;
      }
      state.currentSlideIndex = message.index;
      persistState();
      // Tell only the audience tab — presenter already has the correct state.
      if (state.audienceTabId !== null) {
        chrome.tabs.sendMessage(
          state.audienceTabId,
          { type: 'SLIDE_CHANGED', index: message.index }
        ).catch(() => {});
      }
      sendResponse({ ok: true });
      return;
    }

    default:
      // Unknown message — close the response port cleanly.
      sendResponse();
  }
}

// ─── Cleanup listeners ────────────────────────────────────────────────────────

// Presenter window removed (× button OR result of intentional chrome.windows.remove).
// Because closePresenterMode() nulls presenterWindowId BEFORE calling remove(),
// the intentional-stop path produces presenterWindowId === null here → no match.
// Only the × button (accidental) path reaches this with a live windowId.
chrome.windows.onRemoved.addListener(async (windowId) => {
  await stateReady;
  if (windowId !== state.presenterWindowId) return;

  console.log(`${LOG} presenter window closed by × — session preserved for recovery`);
  // Null out so closePresenterMode skips chrome.windows.remove (already gone).
  state.presenterWindowId = null;
  // Do NOT delete the session — it survives for the next P press.
  closePresenterMode();
});

// Audience tab closed while presenter mode is active
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await stateReady;
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
