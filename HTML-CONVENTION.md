# HTML-CONVENTION — Struktura HTML prezentace

Tento dokument definuje, jakou strukturu má HTML prezentace mít, aby s ní HTMLpresenter fungoval **bez konfigurace**. Je to zároveň reference pro uživatele a system prompt pro AI nástroje (Claude, ChatGPT, atd.).

---

## Minimální HTML prezentace

```html
<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <title>Moje prezentace</title>
  <style>
    body { margin: 0; font-family: -apple-system, sans-serif; }
    section.slide {
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 4rem;
      box-sizing: border-box;
    }
    section.slide:not(:first-child) { display: none; }
    /* HTMLpresenter override-uje viditelnost přes data atributy */
  </style>
</head>
<body>

  <section class="slide">
    <h1>Title slide</h1>
    <p>Subtitle</p>
    <aside class="notes">
      Hi everyone, welcome to the presentation. 
      Start with the problem, then introduce solution.
    </aside>
  </section>

  <section class="slide">
    <h2>Second slide</h2>
    <p>Content here</p>
    <aside class="notes">
      Spend ~3 minutes here. Key point: emphasize that X causes Y.
    </aside>
  </section>

  <!-- ... další slidy ... -->

</body>
</html>
```

To je celé. Žádné importy, žádné dependence, jeden soubor.

---

## Závazná pravidla

### 1. Slide = `<section class="slide">`

Každý slide je `<section>` element s class `slide`.

Alternativy, které HTMLpresenter taky detekuje (v pořadí priority):
- `.reveal .slides > section` (Reveal.js)
- `section.slide` ← **doporučeno**
- `div.slide`
- `section[data-slide]`
- `body > section` (fallback)

**Doporučení:** Používej `<section class="slide">` — nejlepší kompatibilita.

### 2. Poznámky = `<aside class="notes">` uvnitř slidu

```html
<section class="slide">
  <h1>Topic</h1>
  
  <aside class="notes">
    Tyhle poznámky vidíš jen ty v presenter view.
    Publikum je nevidí.
    Můžeš psát víc odstavců.
  </aside>
</section>
```

Alternativa: `data-notes` atribut:
```html
<section class="slide" data-notes="Krátká poznámka">
  ...
</section>
```

Ale `<aside class="notes">` je standard a doporučená cesta.

### 3. Slidy jsou flat (nejsou v sobě vnořené)

```html
<!-- ✅ Správně -->
<body>
  <section class="slide">...</section>
  <section class="slide">...</section>
  <section class="slide">...</section>
</body>

<!-- ❌ Špatně (Reveal.js vertikální slidy nejsou v v1.0 podporované) -->
<body>
  <section>
    <section class="slide">Vertical 1</section>
    <section class="slide">Vertical 2</section>
  </section>
</body>
```

### 4. Default state: jen první slide viditelný

V CSS skryj všechny slidy kromě prvního. HTMLpresenter pak řídí, který je vidět.

```css
section.slide:not(:first-child) { display: none; }
```

(Pokud používáš Reveal.js, tohle řeší framework za tebe.)

---

## Doporučení (ne povinné, ale lepší výsledek)

### Velikost slidu

Slidy by měly být **fullscreen** (`100vw × 100vh`), aby vypadaly dobře v audience okně:

```css
section.slide {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 4rem;
  box-sizing: border-box;
}
```

### Typography

Pro maximální čitelnost v presenter view doporučujeme:

```css
section.slide h1 { font-size: clamp(3rem, 8vw, 6rem); }
section.slide h2 { font-size: clamp(2rem, 5vw, 4rem); }
section.slide p { font-size: clamp(1.25rem, 2vw, 1.75rem); }
```

`clamp()` zajistí čitelnost na různých rozlišeních.

### Responsive — neřešit

Prezentace se zobrazují vždy fullscreen v Chrome okně, takže complex responsive design je overkill. Jen se ujisti, že obsah se vejde na 1920x1080 a 1280x720.

---

## Příklady kompletních prezentací

### Příklad 1: Minimalistická pre-talk

```html
<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="UTF-8">
  <title>5 lessons from a year of vibe coding</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'SF Pro Display', -apple-system, sans-serif; background: #0a0a0f; color: #fff; }
    section.slide {
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 5rem;
      text-align: center;
    }
    section.slide:not(:first-child) { display: none; }
    h1 { font-size: clamp(3rem, 8vw, 7rem); font-weight: 700; letter-spacing: -0.03em; }
    h2 { font-size: clamp(2.5rem, 6vw, 5rem); font-weight: 600; }
    p { font-size: clamp(1.25rem, 2.5vw, 2rem); opacity: 0.7; margin-top: 2rem; }
    .accent { background: linear-gradient(135deg, #5eb8ff, #b464dc); -webkit-background-clip: text; color: transparent; }
  </style>
</head>
<body>

  <section class="slide">
    <h1>5 lessons from a year of <span class="accent">vibe coding</span></h1>
    <p>Jan Jílek · jilekai.cz</p>
    <aside class="notes">
      Welcome! Quick intro of myself, why I'm here.
      Set expectation: 25 min talk, Q&A at the end.
    </aside>
  </section>

  <section class="slide">
    <h2>1. AI doesn't replace thinking</h2>
    <p>It amplifies it.</p>
    <aside class="notes">
      Tell story about the macpruvodce.cz project.
      Decision to think about the funnel structure BEFORE prompting.
    </aside>
  </section>

  <section class="slide">
    <h2>Thanks.</h2>
    <p>Questions?</p>
    <aside class="notes">
      Be ready for: "What about Cursor vs Claude Code?"
      Mention that I use Claude Code Desktop, not Cursor.
    </aside>
  </section>

</body>
</html>
```

### Příklad 2: Reveal.js prezentace

Pokud používáš Reveal.js, HTMLpresenter funguje out-of-the-box. Reveal.js už používá `<aside class="notes">` a `.reveal .slides > section` jako svůj standard.

---

## System prompt pro AI generování prezentací

Pokud chceš nechat AI vygenerovat HTML prezentaci kompatibilní s HTMLpresenter, použij tento prompt:

```
Vygeneruj HTML prezentaci na téma [TÉMA] s [POČET] slidy.

Struktura:
- Single-file HTML
- Každý slide = <section class="slide">
- Poznámky pro každý slide = <aside class="notes"> uvnitř slidu
- Slidy fullscreen (100vw × 100vh)
- Tmavý design, moderní typography
- Inline CSS v <style> tagu, žádné externí závislosti

Pravidla pro poznámky:
- Každý slide musí mít poznámky (3-5 vět)
- Poznámky jsou pro mluvčího, ne pro publikum
- Konkrétní tipy ("zmiň X", "pauza zde", "Q&A")
- Neopakuj přesně obsah slidu — doplň ho

Pravidla pro slidy:
- Maximálně 7 slov v hlavním nadpisu
- Maximálně 1 myšlenka na slide
- Visual hierarchy: jeden hlavní element + jeden podpůrný

Téma: [TÉMA]
Počet slidů: [POČET]
Tón: [profesionální / vibe / humorný]
```

---

## Validace prezentace

Před spuštěním HTMLpresenter zkontroluj:

- [ ] Prezentace má alespoň 2 slidy
- [ ] Každý slide má unique identifikaci (pozice v DOM stačí)
- [ ] V CSS jsou všechny slidy kromě prvního skryté
- [ ] `<aside class="notes">` jsou uvnitř `<section class="slide">`, ne mimo
- [ ] HTML je valid (žádné unclosed tagy)

Pokud HTMLpresenter detekci selže, popup ukáže "No slides detected" — zkontroluj strukturu.

---

## Co HTMLpresenter NEDĚLÁ s tvým HTML

**Důležité pro důvěru:**

- Nikdy nemění zdroj HTML souboru na disku
- Nikdy neposílá obsah prezentace na server (žádný cloud, žádné tracking)
- Nikdy neukládá obsah slidů, jen poznámky (a to jen do tvého lokálního Chrome storage)
- Když odejdeš z presenter modu, stránka se vrátí do původního stavu

Edits poznámek se ukládají do `chrome.storage.local`. Když chceš poznámky přenést na jiný počítač, použij tlačítko "Export HTML" v presenter view — dostaneš nový HTML soubor s aktualizovanými poznámkami.
