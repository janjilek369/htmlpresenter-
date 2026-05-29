# BRIEF — HTMLpresenter

## Co produkt je

Chrome extension, která dodá libovolné HTML prezentaci profesionální presenter view se dvěma okny: jedno pro publikum (sdílené na webináři), druhé pro prezentujícího (s poznámkami, timerem, náhledem dalšího slidu).

## Pro koho je v1.0

**Jeden uživatel: Jan Jílek.**

Postaveno primárně pro vlastní použití — webináře, prezentace pro školy, AI workshopy. Veřejná distribuce přijde později jako samostatná fáze.

To znamená:
- **Žádné kompromisy pro generic uživatele** — design a UX můžou být explicitně postavené pro Janův workflow
- **Žádné edge cases pro neznámé HTML struktury** — stačí, aby fungovalo s prezentacemi, které generuje Claude nebo Jan ručně píše
- **Žádné multi-language UI** — angličtina stačí
- **Feedback je okamžitý** — Jan testuje, Jan reportuje, Jan rozhoduje

## Hlavní use case

1. Jan nechá Claude vygenerovat HTML prezentaci na téma (např. AI workshop, vibe coding talk, Apple v škole)
2. Otevře HTML soubor v Chrome (drag-and-drop nebo dvojklik)
3. Stiskne klávesu **P** (nebo klikne na ikonu extension)
4. Extension otevře:
   - **Audience okno** = fullscreen prezentace, sdílí se na webináři / promítá se z projektoru
   - **Presenter okno** = poznámky + náhledy slidů + timer, jen pro Jana
5. Prezentuje (šipky vpravo/vlevo, pravé tlačítko myši = další slide)
6. V průběhu může editovat poznámky, měnit velikost textu poznámek
7. Esc ukončí presenter mode

## Klíčové vlastnosti pro v1.0

- Funguje na libovolné HTML prezentaci s rozumnou strukturou (viz HTML-CONVENTION.md)
- Spustí se klávesou P
- Two-window setup: audience + presenter
- Poznámky čitelné z dálky (Jan má daleko od monitoru při prezentaci)
- Možnost zvětšit/zmenšit text poznámek (teleprompter mode)
- Editovat poznámky live, uložit do chrome.storage
- Export HTML s aktualizovanými poznámkami (pro přenos na jiný počítač)
- Glassmorphism design 2026 (viz DESIGN.md)
