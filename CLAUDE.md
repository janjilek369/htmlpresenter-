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
- **chrome.storage.local** pro ukládání edits poznámek (per-presentation klíč)
- **chrome.windows API** pro správu dvou oken
- **chrome.runtime messaging** pro komunikaci mezi okny přes background service worker

**Proč vanilla JS:** Extension musí být lightweight a rychlá. Žádné bundlery → vývojový cyklus = uložit kód + reload v Chrome = okamžitá zpětná vazba.

---

## Struktura projektu

```
htmlpresenter/
├── manifest.json              — Manifest V3 konfigurace
├── background.js              — Service worker (state, messaging)
├── content.js                 — Injected do prezentace, detekce slidů, ovládání
├── content.css                — Styly pro audience okno (skrytí ne-aktivních slidů)
├── presenter/
│   ├── presenter.html         — Presenter view HTML
│   ├── presenter.css          — Glassmorphism design
│   ├── presenter.js           — UI logika presenter okna
│   └── fonts/                 — Geist font soubory (self-hosted, viz DESIGN.md)
├── popup/
│   ├── popup.html             — Malý popup po kliknutí na ikonu extension
│   ├── popup.css
│   └── popup.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png            — Stačí pro lokální use, store ikony až později
├── test-presentations/        — Testovací HTML prezentace pro vývoj
│   ├── minimal.html
│   ├── reveal-js.html
│   └── ai-generated.html
└── README.md                  — Krátké info pro budoucí (instalace, reload)
```

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
- Quick edit slidu z presenter view
- Světlý mode
- Vlastní konfigurace selektoru slidů (auto-detekce musí stačit)
- Cloud sync poznámek
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
