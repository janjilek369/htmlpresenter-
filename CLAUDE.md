# HTMLpresenter — Chrome Extension

## Co tento projekt je

HTMLpresenter je Chrome extension, která přidává presenter view k libovolné HTML prezentaci otevřené v Google Chrome. Cílem v1.0 je **funkční extension pro osobní použití autora (Jan Jílek)** — používání na vlastních webinářích a prezentacích.

**Distribuce v1.0:** lokálně přes `chrome://extensions/` (Load unpacked). Žádný Chrome Web Store, žádná veřejná distribuce. To přijde později.

**Hlavní hodnota:** "Otevři HTML → stiskni P → máš profesionální presenter view."

---

## Tech stack

- **Manifest V3** (povinné, V2 už Chrome nepřijímá)
- **Vanilla JavaScript (ES2023)** — žádný framework, žádné build tools
- **HTML + CSS** pro presenter UI
- **chrome.storage.local** — UI preference presenteru (téma: dark/light)
- **chrome.storage.session** — session recovery (pozice slidu + live editace poznámek, přežije náhodné zavření okna, maže se se zavřením Chrome)
- **chrome.windows API** pro správu dvou oken
- **chrome.runtime messaging** pro komunikaci mezi okny přes background service worker

**Proč vanilla JS:** Extension musí být lightweight a rychlá. Žádné bundlery → vývojový cyklus = uložit kód + reload v Chrome = okamžitá zpětná vazba.

---

## Struktura projektu

```
htmlpresenter/
├── manifest.json              — Manifest V3 konfigurace
├── background.js              — Service worker (state, messaging, session recovery)
├── content.js                 — Injected do prezentace, detekce slidů, ovládání
├── content.css                — Styly pro audience okno (skrytí ne-aktivních slidů)
├── presenter/
│   ├── presenter.html         — Presenter view HTML (toolbar, recovery dialog, thumbnails)
│   ├── presenter.css          — Glassmorphism design, dark + light theme tokens
│   ├── presenter.js           — UI logika: timer, editace, session, téma, navigace
│   └── fonts/
│       ├── Geist-Variable.woff2      — Self-hosted Geist sans (Vercel)
│       └── GeistMono-Variable.woff2  — Self-hosted Geist mono
├── popup/
│   ├── popup.html             — Malý popup po kliknutí na ikonu extension
│   ├── popup.css
│   └── popup.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png            — Stačí pro lokální use, store ikony až později
├── test-presentations/        — Testovací HTML prezentace pro vývoj
│   ├── minimal.html           — 3 slidy, JSON notes block (primary formát)
│   └── test-fallback.html     — Stejné slidy, <aside class="notes"> (fallback test)
└── README.md                  — Instalace, usage, tech stack
```

---

## Implementované funkce (v0.1.0)

Co aktuálně funguje — pro orientaci při pokračování vývoje:

**Detekce slidů a poznámek**
- Auto-detekce podle 5 selektorů (Reveal.js, `section.slide`, `div.slide`, `section[data-slide]`, `body > section`)
- Poznámky: JSON block `<script type="application/json" id="presenter-notes">` jako primary formát, `<aside class="notes">` jako fallback, `data-notes` attr jako poslední záchrana
- `<aside class="notes">` se vždy odstraní z DOM (audience nevidí)

**Presenter window**
- Glassmorphism UI: glasspanely, Geist font, tmavý background s ambient gradienty
- Live náhledy slidů ve footeru: iframe `srcdoc`, 1280×720 skalované `Math.min(w/1280, h/720)` (contain mode)
- Slide counter, timer s pause/resume (long-press 1 s = reset)
- Ovládání šipkami, Esc pro ukončení
- Otevírá se vždy VPředu (focused: true + drawAttention + 80ms guard)

**Editace poznámek (live, in-session)**
- Tlačítko Edit → `contenteditable`, toolbar s B/I tlačítky
- Klávesové zkratky: Cmd/Ctrl+B, Cmd/Ctrl+I, Esc pro cancel
- Uloženo v paměti jako HTML (`sessionEdits` objekt, per slide index)
- Auto-save při přechodu na jiný slide

**Session recovery**
- Ukládá se do `chrome.storage.session` (klíč `session:<url>`)
- Ukládá: `currentSlideIndex`, `editedNotes`, `slideCount`, `timestamp`
- Throttlováno: debounce 2 s
- Při startu presenteru: pokud existuje záznam < 2 h → dialog "Continue / Start fresh"
- Intentional Esc → smaže session; zavření křížkem → session přežívá
- Background rozlišuje accidental vs intentional přes `state.intentionalStop` flag

**Dark/light theme**
- Přepínač v headeru (Phosphor sun/moon SVG ikona)
- Light theme: `[data-theme="light"]` na `<html>`, přepisuje CSS proměnné
- Persistence: `chrome.storage.local`, klíč `presenter-theme`
- Smooth transition 300 ms na color, background-color, border-color, box-shadow

---

## Pořadí čtení dokumentace

Když začínáš pracovat, čti v tomto pořadí:

1. **BRIEF.md** — kdo je uživatel, co produkt řeší, jaký je use case
2. **SPEC.md** — co přesně produkt dělá, jaké jsou funkce v1.0
3. **HTML-CONVENTION.md** — jakou strukturu HTML prezentace má extension detekovat
4. **DESIGN.md** — vizuální systém, glassmorphism, barvy, komponenty
5. **DEV-SETUP.md** — jak extension nainstalovat, reloadovat, debugovat

Když pracuješ na konkrétní části:
- **Detekce slidů a poznámek** → HTML-CONVENTION.md + SPEC.md
- **UI presenter view** → DESIGN.md + SPEC.md
- **Testování** → DEV-SETUP.md

---

## Klíčové principy

1. **Funguje na 100 %.** Žádné "skoro funguje" features. Když něco ve v1.0 nevyřešíme robustně, vynecháme to.

2. **Glassmorphism konzistentně.** Každý panel v presenter view má stejný backdrop-filter, stejné stíny, stejný border. Konzistence nad variací.

3. **Klávesnice je první.** Šipky, P, Esc — vše ovládatelné z klávesnice. Myš je sekundární.

4. **Nezasahuj do HTML prezentace.** Extension čte DOM, mění viditelnost slidů přes CSS, ale **nikdy nepřepisuje** strukturu HTML. Uživatelův soubor zůstává nedotčený (kromě explicitního Export HTML).

5. **AI-friendly konvence.** HTML konvence musí být tak jednoduchá, aby ji Claude/ChatGPT vygeneroval bez explicitní instrukce (Reveal.js standard).

6. **Žádný build step.** Pište kód tak, aby šel rovnou nahrát do Chrome. Žádný webpack, žádný TypeScript compile, žádný npm install. Vanilla JS, vanilla CSS, hotovo.

---

## Coding conventions

- **ES2023+ syntax**, async/await pro asynchronní operace
- **JSDoc komentáře** u všech exportovaných funkcí
- **Konstanty velkými písmeny** (`const STORAGE_KEY_PREFIX = 'htmlpresenter:'`)
- **Žádné inline styly** v JS, vše v CSS souborech s CSS variables
- **CSS variables pro design tokens** (viz DESIGN.md)
- **Anglické názvy** proměnných, funkcí, souborů
- **České komentáře OK** v rámci kódu (pokud pomáhají Janovi)

---

## Jazyk

- **Kód a kód komentáře:** angličtina
- **Extension UI:** angličtina
- **Komunikace s Janem:** čeština

---

## Co NENÍ ve v1.0 (vědomé rozhodnutí)

- Blackout/whiteout klávesa
- Spotlight / laser pointer
- Jump to slide číslem
- Follow link pro vzdálené diváky
- Quick edit slidu z presenter view (jen poznámky, ne obsah slidu)
- Vlastní konfigurace selektoru slidů (auto-detekce musí stačit)
- Cloud sync poznámek (session edits jsou in-memory + session storage, ne trvalé)
- Export HTML s upravenými poznámkami (stub, přijde v KROK 4)
- Chrome Web Store publikace
- Privacy policy, store assets, marketing copy
- Lokalizace (jen angličtina)

Pokud při vývoji narazíš na pokušení něco z tohohle přidat, **odolej** a poznamenej do `IDEAS.md` (vytvoř pokud neexistuje) pro budoucí verze.

---

## Otázky pro Jana

Když narazíš na rozhodnutí, které není v dokumentaci jednoznačné, **zeptej se Jana před implementací**. Lepší 2 minuty otázek než hodinu refactoringu. Specificky:

- Edge cases v detekci slidů (různé struktury HTML)
- Animace a transitions (jaký feeling)
- Texty v UI (i krátké stringy mají dopad na UX)
