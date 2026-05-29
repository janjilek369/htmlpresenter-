# HTMLpresenter

Chrome extension that adds a presenter view to any HTML presentation.
Press `P` — two windows open: audience (share this on your webinar) and presenter
(notes, timer, slide previews).

![screenshot placeholder](screenshot.png)
<!-- TODO: add screenshot -->

## Features

- Two-window presenter mode — audience window shows the slide fullscreen, presenter window shows everything else
- Speaker notes with inline formatting (bold, italic, line breaks)
- Live slide previews — current and next slide rendered in real time
- Timer with pause / resume (long-press to reset)
- Dark and light theme, persisted between sessions
- Session recovery — if the presenter window closes accidentally, pick up where you left off

## Installation

1. Clone or download this repo
2. Open `chrome://extensions/`
3. Enable "Developer mode" (top right toggle)
4. Click "Load unpacked" and select this folder

No build step, no npm install.

## Usage

1. Open an HTML presentation in Chrome
2. Press `P`
3. **Audience window** — fullscreen slide, share this on your webinar
4. **Presenter window** — notes, timer, current + next slide preview
5. `→` / `←` or right-click to navigate, `Esc` to exit
6. Click **Edit** to edit notes live (changes stay for the session)

## HTML Convention

Presentations must use a standard slide structure. See `HTML-CONVENTION.md` for the full spec.

Supported out of the box: Reveal.js, `<section class="slide">`, `<div class="slide">`,
`<section data-slide>`, plain `<body> > <section>`.

Speaker notes: preferred format is a JSON block in the `<head>` —
see `HTML-CONVENTION.md`. The `<aside class="notes">` Reveal.js convention also works.

To generate a compatible presentation with Claude, use the built-in skill:
`vytvor-html-prezentaci-pro-presenter`

## Development

- **Reload extension after JS/manifest changes:** `chrome://extensions/` → click the reload icon
- **Reload content script:** press `F5` on the presentation page (reloads the tab)
- **Debug presenter window:** right-click → Inspect in the presenter popup
- **Debug background:** `chrome://extensions/` → "Service Worker" → Inspect
- Full setup and debugging guide: `DEV-SETUP.md`
- Project conventions and architecture: `CLAUDE.md`

## Tech

Manifest V3 · Vanilla JavaScript (ES2023) · No build step · Geist font (self-hosted)

## Status

v0.1.0 — working, private use. Chrome Web Store distribution TBD.
