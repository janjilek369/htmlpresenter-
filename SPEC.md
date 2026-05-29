# SPEC — Funkční specifikace v1.0

Tento dokument definuje **co přesně** extension dělá. Pokud něco v této specifikaci chybí, není to v rozsahu v1.0.

---

## 1. Aktivace extension

### 1.1 Spuštění presenter modu

Uživatel může spustit presenter mode dvěma způsoby:

**A) Klávesa P** — když je v aktivní záložce HTML prezentace (která projde detekcí slidů, viz sekce 2), stisk klávesy `P` (bez modifikátorů, kdekoli na stránce mimo input/textarea) otevře presenter mode.

**B) Klik na ikonu extension** — otevře popup (viz sekce 6) s tlačítkem "Start Presenter". Klik na tlačítko spustí presenter mode.

### 1.2 Co se stane při spuštění

1. Extension detekuje slidy v aktuální záložce (viz sekce 2)
2. Pokud detekce selže (méně než 2 slidy nalezeno), zobrazí v popup error: "No slides detected. See HTML convention guide."
3. Pokud detekce uspěje:
   - **Aktuální záložka** se stane **Audience oknem** — extension injects CSS, který skryje všechny slidy kromě aktivního, a maximalizuje viewport (fullscreen)
   - **Nové okno** se otevře jako **Presenter okno** s designem podle DESIGN.md
   - Obě okna jsou propojená přes background service worker

### 1.3 Ukončení

- Klávesa **Esc** v kterémkoli okně ukončí presenter mode
- Zavření presenter okna ukončí presenter mode
- Zavření audience okna ukončí presenter mode
- Ukončení obnoví původní stav stránky (odebere injected CSS, vrátí normální layout)

---

## 2. Detekce slidů a poznámek

### 2.1 Auto-detekce slidů

Extension zkouší následující selektory v tomto pořadí, vezme první, který vrátí 2+ elementy:

1. `.reveal .slides > section` (Reveal.js prezentace)
2. `section.slide` (HTML convention dle HTML-CONVENTION.md)
3. `div.slide`
4. `section[data-slide]`
5. `body > section` (jako fallback pro single-file prezentace)

Pokud žádný selektor nevrátí 2+ elementy, detekce selhala.

### 2.2 Detekce poznámek

Pro každý slide extension hledá poznámky v tomto pořadí:

1. Element `<aside class="notes">` uvnitř slidu (Reveal.js standard)
2. Element s atributem `data-notes` uvnitř slidu (text z atributu = poznámka)
3. Žádné poznámky (zobrazí se placeholder v presenter view: "No notes for this slide")

Poznámky se z slidu **odstraní z DOM v audience okně** (aby se neukazovaly publiku), ale **uchovají se v paměti** pro zobrazení v presenter okně.

### 2.3 Edge cases

- **Nested slidy** (Reveal.js vertikální slidy): v1.0 podporujeme jen flat strukturu. Nested se chovají jako další horizontální slidy.
- **Slidy s `display: none`** v původním CSS: extension override-uje s `!important`.
- **Animované elementy** v slidu (fragments): v1.0 ignorujeme, slide se vždy zobrazí celý.

---

## 3. Audience okno

### 3.1 Vzhled

- Zachová původní design HTML prezentace (extension nezasahuje do obsahu slidů)
- Aktivní slide je zobrazen, ostatní jsou skryté přes `display: none !important`
- Stránka se chová jako fullscreen (skryté scrollbary, slide centrovaný)
- Žádné UI elementy extension nejsou viditelné v tomto okně

### 3.2 Ovládání v audience okně

- **Pravá šipka / šipka dolů / pravé tlačítko myši** = další slide
- **Levá šipka / šipka nahoru** = předchozí slide
- **Esc** = ukončit presenter mode
- Klávesy jsou zachycené i v audience okně, ne jen v presenter okně

### 3.3 Synchronizace

Když se slide změní v audience okně (např. pravým klikem), presenter okno se okamžitě aktualizuje. A naopak.

Mechanismus: background service worker drží `currentSlideIndex` jako single source of truth. Obě okna mu posílají zprávy přes `chrome.runtime.sendMessage` a dostávají broadcasts při změnách.

---

## 4. Presenter okno

### 4.1 Layout (top to bottom)

```
┌──────────────────────────────────────────────────────────┐
│  [Logo] HTMLpresenter      Slide 5 / 24       ⏱ 12:34   │  ← header bar
├──────────────────────────────────────────────────────────┤
│                                                          │
│                                                          │
│     POZNÁMKY pro aktuální slide                          │
│     (velký, dobře čitelný text)                          │  ← notes panel
│     Editovatelné po kliknutí na "Edit"                   │     (hlavní prostor)
│                                                          │
│                                                          │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  [A−] [A+] [Edit] [Export HTML]            [⏸ Reset]    │  ← controls bar
├──────────────────────────────────────────────────────────┤
│  Current slide preview     |    Next slide preview      │  ← footer (thumbnails)
└──────────────────────────────────────────────────────────┘
```

### 4.2 Header bar

- **Logo + název** "HTMLpresenter" (vlevo, malé)
- **Slide counter** "Slide 5 / 24" (uprostřed, Geist Mono)
- **Timer** ⏱ 12:34 (vpravo, Geist Mono)

### 4.3 Notes panel (hlavní prostor)

- **80 % vertikálního prostoru** okna
- **Velký text** (default 24px, škálovatelný 16px–48px)
- **Geist Sans**, line-height 1.6, color: white s 90% opacity
- **Glassmorphism panel** (viz DESIGN.md)
- **Editovací mód:**
  - Klik na "Edit" tlačítko → notes panel se stane `contenteditable`
  - Text editujete v place
  - Klik na "Done" (tlačítko se transformuje) → uloží do chrome.storage
  - Esc během editace = cancel (vrátí původní text)

### 4.4 Controls bar

- **[A−]** — zmenší text poznámek o 2px (min 16px)
- **[A+]** — zvětší text poznámek o 2px (max 48px)
- **[Edit / Done]** — toggle edit mode
- **[Export HTML]** — stáhne aktualizovanou HTML s upravenými poznámkami (viz sekce 5)
- **[⏸ Reset]** — pause/play + reset timer (kombinovaný button, klik = pause/play, long-press 1s = reset)

### 4.5 Footer (thumbnails)

- **Current slide preview** (vlevo, 50 % šířky)
  - Live render aktuálního slidu (iframe nebo DOM klon)
  - Label "Current"
- **Next slide preview** (vpravo, 50 % šířky)
  - Live render dalšího slidu
  - Label "Next" + číslo slidu

**Pokud je aktuální slide poslední**, "Next" zobrazí "End of presentation" placeholder.

### 4.6 Velikost a chování okna

- **Default velikost:** 1200 × 800 px
- **Min velikost:** 800 × 600 px
- **Resizable:** ano (responsive layout)
- **Position:** vedle audience okna (extension to spočítá podle dostupných monitorů, ale uživatel ho může přesunout)

---

## 5. Ukládání a export poznámek

### 5.1 Zdroj poznámek (priorita)

Při startu presenter modu pro každý slide:

1. Pokud existují edits v `chrome.storage.local` pro tento slide → použij je
2. Jinak → použij poznámky z HTML (`<aside class="notes">`)
3. Jinak → prázdné

### 5.2 Klíč pro chrome.storage

Klíč je content hash prezentace:
```
htmlpresenter:notes:{sha256_of_presentation_title_and_first_500_chars}:{slide_index}
```

**Proč ne URL:** URL se může změnit (file:// vs https://, různé počítače). Hash obsahu identifikuje prezentaci stabilně.

### 5.3 Ukládání edits

- Edit poznámek → po kliknutí "Done" se uloží do chrome.storage
- Žádný auto-save během psaní (jen po Done)
- Esc během editace = neukládá (zachová původní text)

### 5.4 Export HTML

Klik na "Export HTML":
1. Extension načte celý HTML zdrojový kód aktuální prezentace
2. Pro každý slide, který má edited notes, nahradí původní `<aside class="notes">` obsah novým
3. Pokud slide neměl `<aside class="notes">` ale teď má edited notes, přidá nový `<aside class="notes">` element před koncem slidu
4. Stáhne soubor jako `{original_filename}-with-notes.html` (přes `chrome.downloads` API)

**Tlačítko Export HTML je vždy aktivní**, i když uživatel nic needitoval (může chtít stáhnout HTML s aktuálními poznámkami pro přesun na jiný počítač).

---

## 6. Popup (klik na ikonu extension)

### 6.1 Stav 1: Stránka NENÍ prezentace

```
┌────────────────────────────────────┐
│  HTMLpresenter                     │
│                                    │
│  No presentation detected on       │
│  this page.                        │
│                                    │
│  Open an HTML presentation with    │
│  <section class="slide"> structure │
│  to start.                         │
│                                    │
│  [Learn more →]                    │
└────────────────────────────────────┘
```

Tlačítko "Learn more" otevře nový tab s HTML-CONVENTION.md (nebo veřejnou dokumentační stránku).

### 6.2 Stav 2: Stránka JE prezentace

```
┌────────────────────────────────────┐
│  HTMLpresenter                     │
│                                    │
│  ✓ Presentation detected           │
│  24 slides found                   │
│                                    │
│  [ Start Presenter ]               │
│                                    │
│  Tip: Press P anywhere on the page │
└────────────────────────────────────┘
```

Klik na "Start Presenter" spustí presenter mode (stejně jako klávesa P).

### 6.3 Stav 3: Presenter mode už běží

```
┌────────────────────────────────────┐
│  HTMLpresenter                     │
│                                    │
│  ● Presenter active                │
│  Slide 5 / 24                      │
│                                    │
│  [ Stop Presenter ]                │
└────────────────────────────────────┘
```

---

## 7. Klávesové zkratky (souhrn)

| Klávesa | Akce | Kontext |
|---------|------|---------|
| `P` | Spustit presenter mode | Stránka s prezentací (mimo input) |
| `Esc` | Ukončit presenter mode | Obě okna |
| `→` / `↓` | Další slide | Obě okna |
| `←` / `↑` | Předchozí slide | Obě okna |
| `Mouse Right Click` | Další slide | Audience okno |
| `Esc` (during edit) | Zrušit edit poznámek | Presenter okno, edit mode |

---

## 8. Co se NEDĚLÁ ve v1.0

Tyhle features jsou **vědomě vynechané**, neimplementuj je:

- ❌ Blackout (B klávesa) — možná v1.1
- ❌ Whiteout (W klávesa)
- ❌ Spotlight / laser pointer
- ❌ Jump to slide číslem (1-9 + Enter)
- ❌ Drawing / annotations na slidu
- ❌ Follow link pro vzdálené diváky
- ❌ Cloud sync poznámek
- ❌ Quick edit slidu z presenter view
- ❌ Vlastní konfigurace selektorů (auto-detekce musí stačit)
- ❌ Světlý mode
- ❌ Multi-language UI (jen angličtina v v1.0, lokalizace v1.1)
- ❌ Animace fragments uvnitř slidu

Pokud se zdá, že některá feature je "skoro hotová" a stálo by za to ji dodělat, **ZASTAV** a zeptej se Jana.

---

## 9. Acceptance kritéria pro v1.0

Extension je hotová, když:

- [ ] Detekuje slidy v testovacích prezentacích (`test-presentations/` — Jan dodá průběžně)
- [ ] P spustí presenter mode bez chyb
- [ ] Esc ukončí presenter mode a obnoví původní stav stránky
- [ ] Šipky a pravé tlačítko mění slide v obou oknech synchronně
- [ ] Poznámky se zobrazují, lze měnit velikost (16-48px), lze editovat
- [ ] Editované poznámky se ukládají do chrome.storage a zachovají se mezi reloads
- [ ] Export HTML stáhne validní HTML s aktualizovanými poznámkami
- [ ] Timer funguje, lze pausovat a resetovat
- [ ] Glassmorphism design odpovídá DESIGN.md (vizuální review s Janem)
- [ ] Manifest V3 platný (žádné warnings v `chrome://extensions/`)
- [ ] Funguje na Janově Chrome (aktuální stable verze)
- [ ] Funguje na minimálně 3 reálných Janových HTML prezentacích
- [ ] Funguje na 1 Reveal.js prezentaci (kompatibilita testovaná)
- [ ] README.md krátké info: jak nainstalovat lokálně (Load unpacked), jak reloadovat

**NENÍ součástí v1.0 acceptance** (až v dalších fázích):
- Chrome Web Store submission
- Privacy policy
- Store screenshots a marketing assets
- Lokalizace do češtiny
- Veřejná distribuce
