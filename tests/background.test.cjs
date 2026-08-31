/**
 * background.test.js — dependency-free tests for background.js.
 *
 * Run with:  node tests/background.test.js
 *
 * Mocks the chrome.* APIs and loads background.js in an isolated VM context.
 * The key capability is simulating a Manifest V3 service worker termination:
 * a "restart" creates a fresh VM context (fresh in-memory state) while the
 * mocked chrome.storage.session backing store survives — exactly what happens
 * when Chrome kills an idle service worker mid-presentation.
 */

'use strict';

const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

/** Deep-clone helper — storage must not share references with live state. */
const clone = (x) => JSON.parse(JSON.stringify(x));

/**
 * Create a browser environment that OUTLIVES service worker restarts:
 * session storage backing store, open windows/tabs registry.
 */
function createEnv() {
  return {
    sessionStore: {},          // chrome.storage.session backing store
    openWindows: new Set(),    // window ids that currently exist
    openTabs: new Set([5]),    // tab ids that currently exist (5 = audience)
    tabWindow: { 5: 1 },       // tabId -> windowId
    nextWindowId: 100,
    maxSetBytes: 0,            // >0 = simulate storage.session quota limit
    slowGet: false,            // true = delay storage.get (restore race test)
  };
}

/**
 * "Boot" a service worker: fresh VM context + fresh chrome mock over the
 * shared env. Returns handles to drive it like Chrome would.
 */
function bootWorker(env) {
  const calls = { tabsSent: [], windowsCreated: [] };
  const listeners = { message: null, winRemoved: null, tabRemoved: null };

  const chrome = {
    storage: {
      session: {
        async get(key) {
          if (env.slowGet) await new Promise((r) => setTimeout(r, 20));
          const out = {};
          if (key in env.sessionStore) out[key] = clone(env.sessionStore[key]);
          return out;
        },
        async set(obj) {
          if (env.maxSetBytes && JSON.stringify(obj).length > env.maxSetBytes) {
            throw new Error('Resource::kQuotaBytes quota exceeded');
          }
          Object.assign(env.sessionStore, clone(obj));
        },
        async remove(key) { delete env.sessionStore[key]; },
      },
    },
    runtime: {
      onMessage: { addListener: (fn) => { listeners.message = fn; } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      getURL: (p) => `chrome-extension://test/${p}`,
    },
    windows: {
      async create(opts) {
        const id = env.nextWindowId++;
        const tabId = id + 1000;
        env.openWindows.add(id);
        env.openTabs.add(tabId);
        calls.windowsCreated.push(opts);
        return { id, tabs: [{ id: tabId }] };
      },
      async update(id) {
        if (!env.openWindows.has(id)) throw new Error(`No window with id: ${id}.`);
      },
      async get(id) {
        if (!env.openWindows.has(id)) throw new Error(`No window with id: ${id}.`);
        return { id };
      },
      async remove(id) {
        if (!env.openWindows.has(id)) throw new Error(`No window with id: ${id}.`);
        env.openWindows.delete(id);
        env.openTabs.delete(id + 1000);
        // Chrome fires onRemoved for every removed window, including our own
        if (listeners.winRemoved) await listeners.winRemoved(id);
      },
      onRemoved: { addListener: (fn) => { listeners.winRemoved = fn; } },
    },
    tabs: {
      async get(id) {
        if (!env.openTabs.has(id)) throw new Error(`No tab with id: ${id}.`);
        return { id, windowId: env.tabWindow[id] ?? 1 };
      },
      async sendMessage(id, msg) {
        if (!env.openTabs.has(id)) throw new Error('Could not establish connection.');
        calls.tabsSent.push({ id, msg });
      },
      onRemoved: { addListener: (fn) => { listeners.tabRemoved = fn; } },
    },
  };

  const sandbox = {
    chrome,
    console: { log() {}, warn() {}, error() {} }, // keep test output clean
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'background.js' });

  return {
    calls,
    /** Deliver a runtime message to the worker and await its response. */
    send(message, sender = {}) {
      return new Promise((resolve) => {
        listeners.message(message, sender, resolve);
      });
    },
    /** User closes the presenter window with the × button. */
    async closeWindowExternally(id) {
      env.openWindows.delete(id);
      env.openTabs.delete(id + 1000);
      await listeners.winRemoved(id);
    },
    /** User closes the audience tab. */
    async closeTabExternally(id) {
      env.openTabs.delete(id);
      await listeners.tabRemoved(id);
    },
  };
}

/** Let fire-and-forget persistState() writes settle before "killing" the SW. */
const settle = () => new Promise((r) => setTimeout(r, 30));

/** Standard START_PRESENTER payload from the audience content script. */
function startMsg(overrides = {}) {
  return {
    type: 'START_PRESENTER',
    slideCount: 6,
    notes: ['n0', 'n1', 'n2', 'n3', 'n4', 'n5'],
    styles: '.slide{color:red}',
    slidesHTML: ['<s>0</s>', '<s>1</s>', '<s>2</s>', '<s>3</s>', '<s>4</s>', '<s>5</s>'],
    url: 'file:///deck.html',
    ...overrides,
  };
}
const SENDER = { tab: { id: 5 } };

// ─── Test runner ─────────────────────────────────────────────────────────────

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

(async () => {
  console.log('background.js tests\n');

  await test('happy path: start, navigate, boundaries', async () => {
    const env = createEnv();
    const w = bootWorker(env);

    const started = await w.send(startMsg(), SENDER);
    assert.strictEqual(started.ok, true, 'START_PRESENTER should succeed');
    assert.strictEqual(w.calls.windowsCreated.length, 1, 'presenter window opened');

    let res = await w.send({ type: 'CHANGE_SLIDE', direction: 'next' });
    assert.deepStrictEqual(clone(res), { ok: true, newIndex: 1 });

    // Broadcast is fire-and-forget — let the async sends settle first
    await settle();
    // Broadcast reaches both the audience tab (5) and the presenter tab (1100)
    const targets = w.calls.tabsSent
      .filter((c) => c.msg.type === 'SLIDE_CHANGED' && c.msg.index === 1)
      .map((c) => c.id)
      .sort((a, b) => a - b);
    assert.deepStrictEqual(targets, [5, 1100], 'SLIDE_CHANGED sent to both windows');

    res = await w.send({ type: 'CHANGE_SLIDE', direction: 'prev' });
    assert.deepStrictEqual(clone(res), { ok: true, newIndex: 0 });

    res = await w.send({ type: 'CHANGE_SLIDE', direction: 'prev' });
    assert.strictEqual(res.reason, 'at_first', 'cannot go below slide 0');

    for (let i = 0; i < 5; i++) await w.send({ type: 'CHANGE_SLIDE', direction: 'next' });
    res = await w.send({ type: 'CHANGE_SLIDE', direction: 'next' });
    assert.strictEqual(res.reason, 'at_last', 'cannot go past the last slide');
  });

  await test('REGRESSION: navigation survives service worker restart', async () => {
    const env = createEnv();
    const w1 = bootWorker(env);
    await w1.send(startMsg(), SENDER);
    await w1.send({ type: 'CHANGE_SLIDE', direction: 'next' });
    await w1.send({ type: 'CHANGE_SLIDE', direction: 'next' });
    await settle();

    // Chrome kills the idle service worker; the next keypress boots a new one
    const w2 = bootWorker(env);
    const res = await w2.send({ type: 'CHANGE_SLIDE', direction: 'next' });
    assert.deepStrictEqual(clone(res), { ok: true, newIndex: 3 },
      'restarted worker must continue from slide index 2');

    await settle(); // fire-and-forget broadcast
    const targets = w2.calls.tabsSent
      .filter((c) => c.msg.type === 'SLIDE_CHANGED' && c.msg.index === 3)
      .map((c) => c.id)
      .sort((a, b) => a - b);
    assert.deepStrictEqual(targets, [5, 1100], 'broadcast still reaches both windows');
  });

  await test('restart: GET_STATE and PRESENTER_READY return restored data', async () => {
    const env = createEnv();
    const w1 = bootWorker(env);
    await w1.send(startMsg(), SENDER);
    await w1.send({ type: 'CHANGE_SLIDE', direction: 'next' });
    await settle();

    const w2 = bootWorker(env);
    const state = await w2.send({ type: 'GET_STATE' });
    assert.strictEqual(state.presenterActive, true);
    assert.strictEqual(state.currentSlideIndex, 1);
    assert.strictEqual(state.slideCount, 6);

    const ready = await w2.send({ type: 'PRESENTER_READY' });
    assert.strictEqual(ready.currentSlideIndex, 1);
    assert.strictEqual(ready.notes[1], 'n1');
  });

  await test('message racing the state restore still works (slow storage)', async () => {
    const env = createEnv();
    const w1 = bootWorker(env);
    await w1.send(startMsg(), SENDER);
    await settle();

    env.slowGet = true; // restore in the new worker takes 20 ms
    const w2 = bootWorker(env);
    // Fire immediately — before restoreState() has resolved
    const res = await w2.send({ type: 'CHANGE_SLIDE', direction: 'next' });
    assert.deepStrictEqual(clone(res), { ok: true, newIndex: 1 },
      'handler must wait for state restore before deciding not_active');
  });

  await test('RESUME_AT position survives a later worker restart', async () => {
    const env = createEnv();
    const w1 = bootWorker(env);
    await w1.send(startMsg(), SENDER);
    const res = await w1.send({ type: 'RESUME_AT', index: 4 });
    assert.strictEqual(res.ok, true);
    await settle();

    const w2 = bootWorker(env);
    const nav = await w2.send({ type: 'CHANGE_SLIDE', direction: 'next' });
    assert.deepStrictEqual(clone(nav), { ok: true, newIndex: 5 });
  });

  await test('intentional stop (Esc) after restart clears everything', async () => {
    const env = createEnv();
    const w1 = bootWorker(env);
    await w1.send(startMsg(), SENDER);
    await settle();
    // presenter.js saved a recovery session meanwhile
    env.sessionStore['session:file:///deck.html'] = { currentSlideIndex: 0, timestamp: 1 };

    const w2 = bootWorker(env);
    const res = await w2.send({ type: 'STOP_PRESENTER' });
    assert.strictEqual(res.ok, true);
    assert.ok(!('session:file:///deck.html' in env.sessionStore),
      'recovery session deleted on intentional stop');
    assert.strictEqual(env.openWindows.size, 0, 'presenter window closed');
    await settle();
    const state = await w2.send({ type: 'GET_STATE' });
    assert.strictEqual(state.presenterActive, false);
  });

  await test('accidental × close after restart preserves recovery session', async () => {
    const env = createEnv();
    const w1 = bootWorker(env);
    const started = await w1.send(startMsg(), SENDER);
    assert.strictEqual(started.ok, true);
    await settle();
    env.sessionStore['session:file:///deck.html'] = { currentSlideIndex: 2, timestamp: 1 };

    const w2 = bootWorker(env);
    await w2.closeWindowExternally(100); // user hits × on the presenter window
    await settle();
    assert.ok('session:file:///deck.html' in env.sessionStore,
      'recovery session must survive an accidental close');
    const state = await w2.send({ type: 'GET_STATE' });
    assert.strictEqual(state.presenterActive, false, 'presenter mode ended');
    // And a new P press works again
    const restarted = await w2.send(startMsg(), SENDER);
    assert.strictEqual(restarted.ok, true, 'P works again after × close');
  });

  await test('audience tab closed after restart ends presenter mode', async () => {
    const env = createEnv();
    const w1 = bootWorker(env);
    await w1.send(startMsg(), SENDER);
    await settle();

    const w2 = bootWorker(env);
    await w2.closeTabExternally(5);
    await settle();
    const state = await w2.send({ type: 'GET_STATE' });
    assert.strictEqual(state.presenterActive, false);
    assert.strictEqual(env.openWindows.size, 0, 'presenter window closed too');
  });

  await test('second start while active is rejected (window alive)', async () => {
    const env = createEnv();
    const w = bootWorker(env);
    await w.send(startMsg(), SENDER);
    const res = await w.send(startMsg(), SENDER);
    assert.strictEqual(res.reason, 'already_active');
  });

  await test('HARDENING: stale active state (window vanished) does not block P', async () => {
    const env = createEnv();
    const w1 = bootWorker(env);
    await w1.send(startMsg(), SENDER);
    await settle();

    // Presenter window disappears while the worker is dead and the onRemoved
    // event is lost (worst case) → persisted state still says "active".
    env.openWindows.delete(100);
    env.openTabs.delete(1100);

    const w2 = bootWorker(env);
    const res = await w2.send(startMsg(), SENDER);
    assert.strictEqual(res.ok, true,
      'START_PRESENTER must detect the stale window and start fresh');
    assert.strictEqual(env.openWindows.size, 1, 'new presenter window opened');
  });

  await test('HARDENING: storage quota exceeded — navigation still survives restart', async () => {
    const env = createEnv();
    env.maxSetBytes = 20000; // simulate chrome.storage.session quota
    const bigDeck = startMsg({
      slidesHTML: Array.from({ length: 6 }, (_, i) => `<s>${'x'.repeat(50000)}${i}</s>`),
    });

    const w1 = bootWorker(env);
    const started = await w1.send(bigDeck, SENDER);
    assert.strictEqual(started.ok, true);
    await w1.send({ type: 'CHANGE_SLIDE', direction: 'next' });
    await settle();

    const w2 = bootWorker(env);
    const res = await w2.send({ type: 'CHANGE_SLIDE', direction: 'next' });
    assert.deepStrictEqual(clone(res), { ok: true, newIndex: 2 },
      'light-state fallback must keep navigation alive for huge presentations');
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
