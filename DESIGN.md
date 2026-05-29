# DESIGN — Vizuální systém HTMLpresenter

## Designová filozofie

**Apple Vision Pro / visionOS 2026 glassmorphism.**

Klíčové vlastnosti:
- **Depth a hierarchie přes blur a transparenci**, ne přes hrany a barvy
- **Tlumené, sofistikované barvy** — žádné křiklavé akcenty
- **Generous spacing** — UI dýchá
- **Smooth animace** (60 fps), nikdy trhané
- **Klid a precision** — feeling drahého nástroje, ne hravého

Reference, ze kterých vycházíme:
- visionOS UI (semi-transparent panels, soft blur)
- Linear app (precision, dark theme, subtle motion)
- Raycast (developer-tool feeling, glassmorphism v command palette)
- Apple Music desktop app (depth, transparency)

---

## Color system

Všechny barvy jsou CSS variables, definované v `:root`.

```css
:root {
  /* Background layers (dark, sophisticated, not pure black) */
  --bg-base: #0a0a0f;              /* Deepest layer, body background */
  --bg-elevated: #12121a;          /* Slightly elevated areas */
  --bg-panel: rgba(20, 20, 30, 0.55);  /* Glass panels (with backdrop-filter) */
  --bg-panel-strong: rgba(25, 25, 38, 0.75);  /* More opaque panels */
  
  /* Borders (subtle, defines glass edges) */
  --border-glass: rgba(255, 255, 255, 0.08);
  --border-glass-hover: rgba(255, 255, 255, 0.14);
  --border-glass-active: rgba(255, 255, 255, 0.20);
  
  /* Text */
  --text-primary: rgba(255, 255, 255, 0.95);
  --text-secondary: rgba(255, 255, 255, 0.65);
  --text-tertiary: rgba(255, 255, 255, 0.40);
  --text-disabled: rgba(255, 255, 255, 0.25);
  
  /* Accent (single accent color, used sparingly) */
  --accent: #5eb8ff;               /* visionOS-style cool blue */
  --accent-glow: rgba(94, 184, 255, 0.35);
  --accent-soft: rgba(94, 184, 255, 0.12);  /* Backgrounds, hover states */
  
  /* States */
  --success: #34d399;              /* Confirmations, positive feedback */
  --warning: #fbbf24;              /* Caution, edit mode indicator */
  --danger: #f87171;               /* Errors, destructive actions */
  
  /* Shadows (for depth) */
  --shadow-glass: 0 8px 32px rgba(0, 0, 0, 0.4);
  --shadow-glass-strong: 0 16px 48px rgba(0, 0, 0, 0.5);
  --shadow-inner-glow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  
  /* Ambient color glow (subtle gradient na pozadí, dodává life) */
  --ambient-1: rgba(94, 184, 255, 0.08);   /* Top-left cool blue */
  --ambient-2: rgba(180, 100, 220, 0.06);  /* Bottom-right cool purple */
}
```

**Ambient background** — pozadí presenter okna není čistě tmavé. Má jemný gradient:

```css
body {
  background: 
    radial-gradient(ellipse 80% 50% at 20% 0%, var(--ambient-1), transparent 60%),
    radial-gradient(ellipse 60% 50% at 80% 100%, var(--ambient-2), transparent 50%),
    var(--bg-base);
}
```

Tohle dělá zásadní rozdíl mezi "tmavé UI" a "premium tmavé UI."

---

## Typography

**Self-hosted fonty** (žádné Google Fonts CDN, kvůli Chrome Web Store privacy):

- **Geist Sans** (Vercel font, free, OSS) — primární font pro UI a notes
- **Geist Mono** (Vercel mono font) — pro číselné věci (timer, slide counter)

Soubory umístit do `presenter/fonts/`:
- `Geist-Variable.woff2`
- `GeistMono-Variable.woff2`

```css
@font-face {
  font-family: 'Geist';
  src: url('./fonts/Geist-Variable.woff2') format('woff2-variations');
  font-weight: 100 900;
  font-display: swap;
}

@font-face {
  font-family: 'GeistMono';
  src: url('./fonts/GeistMono-Variable.woff2') format('woff2-variations');
  font-weight: 100 900;
  font-display: swap;
}

:root {
  --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --font-mono: 'GeistMono', 'SF Mono', Menlo, monospace;
}
```

### Typography scale

```css
:root {
  /* Sizes */
  --text-xs: 11px;      /* Mikro labels (tab labels, hints) */
  --text-sm: 13px;      /* Sekundární UI (buttons, captions) */
  --text-base: 15px;    /* Default UI */
  --text-md: 17px;      /* Větší UI elementy */
  --text-notes: 24px;   /* Default velikost poznámek (uživatel může změnit 16-48) */
  --text-counter: 20px; /* Slide counter, timer */
  --text-heading: 28px; /* Pokud bychom někde měli headings */
  
  /* Weights (variable font) */
  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --weight-bold: 700;
  
  /* Line heights */
  --leading-tight: 1.2;     /* Headings, slide counter */
  --leading-normal: 1.5;    /* UI text */
  --leading-relaxed: 1.6;   /* Notes (čte se to déle, potřebuje vzduch) */
  
  /* Letter spacing */
  --tracking-tight: -0.02em;   /* Geist looks better slightly tightened */
  --tracking-normal: 0;
  --tracking-wide: 0.04em;     /* Pro uppercase labels */
}
```

---

## Spacing system

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
}
```

**Pravidla:**
- Padding uvnitř panelů: minimálně `--space-6` (24px)
- Gap mezi sekcemi: `--space-8` až `--space-12`
- Padding okolo tlačítek: `--space-3` vertikální, `--space-5` horizontální

---

## Glass panel — základní komponenta

Tohle je vizuální základ celého UI. Každý panel v presenter view používá tuhle definici:

```css
.glass-panel {
  background: var(--bg-panel);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid var(--border-glass);
  border-radius: 20px;
  box-shadow: 
    var(--shadow-glass),
    var(--shadow-inner-glow);
}

.glass-panel--strong {
  background: var(--bg-panel-strong);
}
```

**Klíčové detaily:**
- **`backdrop-filter: blur(40px)`** je hlavní efekt. Bez něj to není glassmorphism, je to jen tmavý panel.
- **`saturate(180%)`** zvyšuje barevnost obsahu za panelem (pokud nějaké je) → premium look
- **`border-radius: 20px`** — visionOS style má větší rounded corners
- **Inner glow** (subtle světlá linka uvnitř horního okraje) — `inset 0 1px 0 rgba(255,255,255,0.06)` — simuluje skutečné sklo s odrazem světla

---

## Buttons

### Primary button

```css
.btn-primary {
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid var(--border-glass);
  border-radius: 12px;
  padding: var(--space-3) var(--space-5);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  letter-spacing: var(--tracking-tight);
  cursor: pointer;
  transition: all 200ms ease;
  backdrop-filter: blur(20px);
}

.btn-primary:hover {
  background: var(--accent);
  color: white;
  border-color: var(--accent-glow);
  box-shadow: 0 0 24px var(--accent-glow);
}

.btn-primary:active {
  transform: scale(0.97);
}
```

### Secondary button (Edit, A−, A+, Export)

```css
.btn-secondary {
  background: var(--bg-panel);
  color: var(--text-secondary);
  border: 1px solid var(--border-glass);
  border-radius: 12px;
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: all 200ms ease;
  backdrop-filter: blur(20px);
}

.btn-secondary:hover {
  background: var(--bg-panel-strong);
  color: var(--text-primary);
  border-color: var(--border-glass-hover);
}

.btn-secondary:active {
  transform: scale(0.97);
}
```

### Icon button (A−, A+, ikony)

```css
.btn-icon {
  /* extends .btn-secondary */
  width: 40px;
  height: 40px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

---

## Klíčové komponenty presenter okna

### Header bar

```css
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-6);
  height: 64px;
  border-bottom: 1px solid var(--border-glass);
  /* Žádný background — header je transparentní nad ambient gradient */
}

.header__logo {
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  letter-spacing: var(--tracking-tight);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.header__counter {
  font-family: var(--font-mono);
  font-size: var(--text-counter);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.header__timer {
  font-family: var(--font-mono);
  font-size: var(--text-counter);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.header__timer--paused {
  color: var(--text-tertiary);
}
```

### Notes panel (hlavní prvek)

```css
.notes-panel {
  /* extends .glass-panel */
  flex: 1;
  margin: var(--space-6);
  padding: var(--space-10) var(--space-12);
  overflow-y: auto;
  font-family: var(--font-sans);
  font-size: var(--notes-size, var(--text-notes));  /* CSS variable for dynamic resize */
  font-weight: var(--weight-regular);
  line-height: var(--leading-relaxed);
  color: var(--text-primary);
  letter-spacing: var(--tracking-tight);
  
  /* Smooth font-size transitions when user clicks A+/A- */
  transition: font-size 150ms ease;
}

.notes-panel[contenteditable="true"] {
  outline: none;
  border-color: var(--accent);
  box-shadow: 
    0 0 0 1px var(--accent-glow),
    var(--shadow-glass);
}

.notes-panel--empty {
  color: var(--text-tertiary);
  font-style: italic;
}
```

**Custom scrollbar** uvnitř notes panelu (subtle, glassmorphism style):

```css
.notes-panel::-webkit-scrollbar { width: 8px; }
.notes-panel::-webkit-scrollbar-track { background: transparent; }
.notes-panel::-webkit-scrollbar-thumb {
  background: var(--border-glass-hover);
  border-radius: 4px;
}
.notes-panel::-webkit-scrollbar-thumb:hover {
  background: var(--border-glass-active);
}
```

### Controls bar

```css
.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-6);
  gap: var(--space-3);
}

.controls__group {
  display: flex;
  gap: var(--space-2);
}
```

### Footer (thumbnails)

```css
.footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
  padding: 0 var(--space-6) var(--space-6) var(--space-6);
  height: 200px;
}

.thumbnail {
  /* extends .glass-panel */
  position: relative;
  overflow: hidden;
}

.thumbnail__preview {
  position: absolute;
  inset: 0;
  /* Tady jde live preview slidu — buď iframe nebo scaled DOM clone */
}

.thumbnail__label {
  position: absolute;
  top: var(--space-3);
  left: var(--space-4);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
  color: var(--text-secondary);
  background: var(--bg-panel-strong);
  backdrop-filter: blur(20px);
  padding: var(--space-1) var(--space-3);
  border-radius: 8px;
  z-index: 1;
}

.thumbnail__label--next {
  color: var(--accent);
}
```

---

## Animace a motion

**Filozofie:** Pohyb dodává život, ale nesmí rozptylovat. Vše plynulé, žádné bouncy efekty.

### Slide transition (změna slidu v thumbnails a notes panelu)

```css
@keyframes fadeSwap {
  0% { opacity: 0; transform: translateY(8px); }
  100% { opacity: 1; transform: translateY(0); }
}

.notes-panel--transitioning,
.thumbnail__preview--transitioning {
  animation: fadeSwap 240ms ease-out;
}
```

### Hover effects

- Buttony: `transition: all 200ms ease`
- Glow effect na primary button (box-shadow expansion)
- Glass panels: žádný hover (jsou statické)

### Timer pulse

Když timer běží, ikona ⏱ má jemnou pulsaci:

```css
@keyframes timerPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.header__timer--running .header__timer__icon {
  animation: timerPulse 2s ease-in-out infinite;
}
```

### Edit mode indicator

Když je notes panel v editovacím módu, border má jemnou animaci:

```css
@keyframes editGlow {
  0%, 100% { box-shadow: 0 0 0 1px var(--accent-glow), var(--shadow-glass); }
  50% { box-shadow: 0 0 0 2px var(--accent-glow), 0 0 32px var(--accent-soft), var(--shadow-glass); }
}

.notes-panel[contenteditable="true"] {
  animation: editGlow 2.5s ease-in-out infinite;
}
```

### Window otevření

Když se presenter okno otevře, fade-in s mírným scale:

```css
@keyframes windowAppear {
  0% { opacity: 0; transform: scale(0.98); }
  100% { opacity: 1; transform: scale(1); }
}

body {
  animation: windowAppear 320ms ease-out;
}
```

---

## Ikony

**Source:** [Phosphor Icons](https://phosphoricons.com/) (free, OSS, moderní).

Self-host jako inline SVG (žádné CDN). Velikost default 18px, color: currentColor.

Potřebné ikony:
- Play, Pause (timer controls)
- Arrow Counter Clockwise (reset)
- Pencil Simple (edit mode)
- Check (done editing)
- Download Simple (export HTML)
- Minus, Plus (font size controls, ale můžou být i textové "A−", "A+")
- Clock (timer prefix)

---

## Layout celého presenter okna

```css
.presenter {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
}

/* Header: fixed height */
/* Notes panel: flex: 1 */
/* Controls: fixed height */
/* Footer: fixed height ~200px */
```

---

## Audience okno styling

V audience okně extension injects minimální CSS:

```css
/* Hide all slides except active */
[data-htmlpresenter-slide]:not([data-htmlpresenter-active]) {
  display: none !important;
}

/* Active slide takes full viewport, centered */
[data-htmlpresenter-active] {
  position: fixed !important;
  inset: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 100vw !important;
  height: 100vh !important;
  background: inherit;
}

/* Hide notes from audience view */
[data-htmlpresenter-slide] aside.notes,
[data-htmlpresenter-slide] [data-notes] {
  display: none !important;
}

/* Hide body scrollbar */
html, body {
  overflow: hidden !important;
}

/* Hide any header/nav/footer that's not a slide */
body > *:not([data-htmlpresenter-slide]):not(script):not(style) {
  display: none !important;
}
```

---

## Responsive chování

Presenter okno musí fungovat od 800x600 do 4K.

**Breakpointy:**

```css
/* Default: desktop normal (1200x800) */

/* Smaller screens (when user resizes window) */
@media (max-width: 1000px) {
  .footer { height: 160px; }
  .notes-panel { padding: var(--space-8) var(--space-8); }
  :root { --text-notes: 20px; }  /* Default smaller on small windows */
}

/* Very small (mobile-like, unusual ale možné) */
@media (max-width: 700px) {
  .footer {
    grid-template-columns: 1fr;
    height: auto;
  }
  .thumbnail { aspect-ratio: 16/9; }
}
```

---

## "Wow moment" pro Chrome Web Store screenshoty

Při focení screenshotů pro store listing:

1. **Hero screenshot** — Presenter okno s naplněnými poznámkami (poutavé téma, např. "Jak funguje difuze v latent space"), aktivním timer, oba thumbnails viditelné. Z venku se musí dát "tu chci."

2. **Akce screenshot** — Edit mode aktivní, glow border kolem notes panelu, kurzor uprostřed.

3. **Two-window setup** — Side-by-side: vlevo audience okno s krásným slidem, vpravo presenter okno. Demonstruje koncept.

4. **HTML zdroj** — Code editor screenshot s minimálním HTML (10 řádků s `<section class="slide">` a `<aside class="notes">`). Vyprávění "tohle stačí."

5. **Customization** — Notes panel s velkým textem (zvětšený přes A+), demonstrace teleprompter modu.

Všechny screenshoty: 1280x800px, dark background, žádné rozptylující prvky.
