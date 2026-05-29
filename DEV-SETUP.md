# DEV-SETUP — Lokální vývoj a testování

Tento dokument vysvětluje, jak extension nainstalovat lokálně do Chrome a jak ji efektivně vyvíjet bez Chrome Web Store.

---

## První instalace

1. Otevři Chrome
2. V address baru napiš: `chrome://extensions/` a stiskni Enter
3. Vpravo nahoře zapni toggle **"Developer mode"**
4. Klikni **"Load unpacked"** (nově se zobrazí 3 tlačítka vlevo nahoře)
5. Vyber složku s extension (kořenová složka projektu, kde je `manifest.json`)
6. Extension se objeví v seznamu a v toolbaru Chrome

**Hotovo.** Extension funguje jako kdyby byla ze store.

---

## Reload extension po změně kódu

Když Claude Code (nebo ty) změníš jakýkoli soubor v extension:

1. Otevři `chrome://extensions/`
2. Najdi HTMLpresenter v seznamu
3. Klikni na **reload ikonu** (kruhová šipka u extension)
4. Změna je aplikovaná

**Tip:** Pin si `chrome://extensions/` jako bookmark, ať to máš na jeden klik.

**Tip pro rychlejší workflow:** existují keyboard shortcuts. Když máš `chrome://extensions/` otevřené, lze reloadnout vše stiskem klávesy **R** (ale musí být focus na stránce).

---

## Co se reloaduje a co ne

**Reloaduje se automaticky** (po reload extension):
- `manifest.json`
- `background.js` (service worker)
- `popup/*` — při dalším otevření popupu

**NEreloaduje se automaticky** — musíš refresh stránky:
- `content.js` a `content.css` — content script se injects jen jednou per page load
- → po reload extension klikni F5 na stránce s prezentací

**Vyžaduje znovuotevření okna:**
- `presenter/*` — pokud máš presenter okno otevřené, zavři ho a otevři znovu

---

## Debugging

### Background service worker

1. `chrome://extensions/`
2. U HTMLpresenter klikni link "service worker" (Inspect views)
3. Otevře se DevTools — vidíš `console.log()` z `background.js`

**Pozor:** service worker se uspí po 30 sekundách neaktivity. Pokud potřebuješ ho probudit, otevři DevTools, on se aktivuje znovu.

### Content script

1. Otevři stránku s prezentací
2. Stiskni F12 (DevTools)
3. Console — vidíš `console.log()` z `content.js`

Filtruj console na "HTMLpresenter:" prefix, ať ho neztratíš v noise.

### Presenter okno

1. Spusť presenter (klávesa P)
2. V presenter okně klikni pravým → "Inspect"
3. DevTools — vidíš `console.log()` z `presenter.js`

### Popup

1. Klikni pravým na ikonu extension v toolbaru
2. "Inspect popup"
3. Popup se otevře s DevTools

---

## Testovací prezentace

Ve složce `test-presentations/` budou tyto soubory pro průběžné testování:

- **`minimal.html`** — Nejjednodušší možná prezentace (3 slidy, plain text, `<section class="slide">` + `<aside class="notes">`)
- **`reveal-js.html`** — Reveal.js boilerplate (test kompatibility s Reveal standardem)
- **`ai-generated.html`** — Příklad výstupu z Claude/ChatGPT (reálná struktura, jakou AI typicky generuje)
- **`no-notes.html`** — Prezentace bez poznámek (test fallback chování)
- **`many-slides.html`** — 20+ slidů (test performance)

**Jan dodá tyto soubory** v průběhu vývoje. Pokud Claude Code potřebuje testovací prezentaci a žádná není k dispozici, **napřed se zeptá Jana** než si jednu vymyslí.

---

## Convention pro načítání HTML do Chrome

Existují 3 způsoby, jak Chrome otevře HTML soubor:

### 1. `file://` (lokální soubor)

```
file:///Users/jan/projects/htmlpresenter/test-presentations/minimal.html
```

**Funguje.** Extension content scripts se injectují i pro `file://` URLs (díky `<all_urls>` v manifestu).

**Pozor:** Pokud HTML načítá lokální assety (images, fonts), musí být v stejné složce nebo relativní cestě. Cross-origin omezení jsou striktnější pro `file://`.

### 2. `http://localhost:PORT` (dev server)

```
http://localhost:3000/presentation.html
```

**Funguje.** Pokud používáš nějaký dev server (např. `python -m http.server`, `npx serve`, Vite preview), Chrome to vidí jako normální web.

**Doporučeno pro vývoj**, protože nemá `file://` omezení.

### 3. Veřejná URL (např. Vercel deployment)

```
https://moje-prezentace.vercel.app/
```

**Funguje.** Stejné jako každý jiný web.

---

## Časté problémy a řešení

### "Extension není v toolbaru"

→ Klikni na puzzle ikonu (Extensions) v toolbaru → pin HTMLpresenter (špendlík).

### "Stisknutí P nedělá nic"

→ Zkontroluj, že:
1. Extension je enabled v `chrome://extensions/`
2. Content script se injectnul (F12 → Console → hledej "HTMLpresenter:" logy)
3. Prezentace má strukturu, kterou extension detekuje (viz HTML-CONVENTION.md)
4. Focus není v `<input>` nebo `<textarea>`

### "Presenter okno se neotevřelo"

→ Chrome může blokovat pop-up okna. V address baru se objeví ikona "Pop-up blocked". Klikni a povol pro tuto stránku.

### "Změna v `content.js` se neprojevila"

→ Po reload extension udělej F5 na stránce s prezentací. Content scripts se injects jen při page load.

### "chrome.storage data zůstávají i po reinstalaci"

→ Pokud potřebuješ vyčistit storage:
```javascript
// V DevTools console extension (background service worker)
chrome.storage.local.clear();
```

Nebo v `chrome://extensions/` → Details → Site settings → Reset.

---

## Git workflow doporučení

Pro Jana:

```bash
# Po každé funkční změně
git add .
git commit -m "feat: popis změny"
git push

# Pro semantic commits doporučuju:
# feat: nová funkcionalita
# fix: oprava chyby
# style: změna designu, žádná funkční změna
# refactor: refactor bez funkční změny
# docs: změna dokumentace
```

Repository drž **privátní** dokud nebudeš ready na veřejnou distribuci. Pak v GitHub Settings → General → Change visibility → Public.

---

## Co až bude extension hotová

Tohle jsou věci, které **nepotřebuješ teď**, ale budou potřeba později (až se rozhodneš distribuovat):

- Privacy Policy (jen pokud budeš sbírat data — extension lokálně to nepotřebuje)
- Chrome Web Store account ($5 jednorázově)
- Screenshoty 1280×800
- Promo tiles
- Store description (EN + případně CS)
- Demo video

Tohle všechno řešíme **až bude jádro funkční a otestované na reálných tvých prezentacích**.
