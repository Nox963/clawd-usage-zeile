import { describe, expect, mock, test } from 'claude-code/testing'

import { kurztitel, offenePunkte, ordneBloecke } from '../hooks/punkte'

// Eine kleine AUFTRAG.md im Aufbau der Vorlage: ein offenes, ein erledigtes und ein
// verworfenes Paket, dazu zwei Punkte unter "Offen"
const AUFTRAG = `# Testvorhaben

## Stand der Abarbeitung

Nichts.

## Offen

- **Farbe des Knopfs:** grau oder orange. Entscheidet der Nutzer.
- Terminal-Fassung aktualisieren, sonst wirkt der Mod dort nicht.

## Pakete

### P-1 · Auswahl ansehen

- **Datei:** \`hooks\\register.tsx\`
- **Stand:** offen, gebaut und getestet 15.10.2026

### P-2 · Alte Zeile

- **Stand:** erledigt 15.10.2026

### P-3 · Koch-Zeile

- **Stand:** verworfen 15.10.2026
`

const PANE = {
  plugin: 'usage-zeile',
  component: 'Pane',
  requestId: 'offene-punkte',
  props: {
    title: 'Offene Punkte',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// Die Usage-Zeile, ueber deren Knopf ≡ das Panel aufgeht
const BAND = {
  plugin: 'usage-zeile',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

// Das Panel ist ein abschaltbarer Teil, im Repository ab Werk aus. Die Tests schalten es an.
const MIT_PANEL = { options: { panel: true } }

describe('offene Punkte', () => {
  test('liest offene Pakete und Punkte, laesst abgeschlossene weg', () => {
    const p = offenePunkte(AUFTRAG, 'C:\\Projekt')
    expect(p.titel).toBe('Testvorhaben')
    expect(p.liste.map(x => x.titel)).toEqual([
      'P-1 · Auswahl ansehen',
      'Farbe des Knopfs',
      'Terminal-Fassung aktualisieren, sonst wirkt der Mod dort nicht.',
    ])
    expect(p.liste[0]?.zusatz).toBe('offen, gebaut und getestet 15.10.2026')
    expect(p.liste[0]?.prompt).toContain('Paket P-1 „Auswahl ansehen“')
    expect(p.liste[1]?.zusatz).toBe('grau oder orange. Entscheidet der Nutzer.')
  })

  test('Kurztitel ist der Teil vor dem Doppelpunkt, der Rest kommt aufgeklappt', () => {
    expect(kurztitel('Skill /beispiel: vollständige Prüfung einer Abschlussarbeit'))
      .toEqual({ kurz: 'Skill /beispiel', rest: 'Vollständige Prüfung einer Abschlussarbeit' })
    expect(kurztitel('API-Messung: welches Modell urteilt wie gut').kurz).toBe('API-Messung')
    expect(kurztitel('Usage-Zeile mit Clawd')).toEqual({ kurz: 'Usage-Zeile mit Clawd', rest: '' })
    expect(kurztitel('Beispiel – Prüfdienst').kurz).toBe('Beispiel')
  })

  test('versteht den Abschnitt der Vorlage mit nummerierten Punkten', () => {
    const vorlage = '# V\n\n## Offen, braucht eine Entscheidung\n\n1. **Alte Fassungen löschen?** 33 Dateien.\n'
      + '2. **Lücken,** entstanden durch Kürzung:\n   - Unterpunkt bleibt beim Punkt.\n\n## Verworfen\n\n- nichts\n'
    expect(offenePunkte(vorlage, 'C:\\V').liste.map(x => x.titel)).toEqual(['Alte Fassungen löschen?', 'Lücken'])
  })

  test('nimmt auch Listen mit Sternchen', () => {
    const stern = '# S\n\n## Offen, braucht eine Entscheidung\n\n* **Bezugspunkt klären.** Zwei Rechnungen.\n* **Suche mitmessen.**\n'
    expect(offenePunkte(stern, 'C:\\S').liste.map(x => x.titel)).toEqual(['Bezugspunkt klären', 'Suche mitmessen'])
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`Panel zeigt die Punkte, ein Klick fuellt das Eingabefeld (${surface})`, MIT_PANEL, async ($, on) => {
      const gefuellt: string[] = []
      // Die App setzt das Panel; im Test steht diese Antwort fuer sie
      on('ui.open', () => ({ value: { isPlaced: true } }))
      // Ein Test hat keinen Dateizugriff, der Mod nimmt die AUFTRAG.md dann aus dem Speicher
      mock.store(on, { 'auftrag-test': { dir: 'C:\\Projekt', content: AUFTRAG } })
      on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
      on('prompt.fill', (_$, e) => { gefuellt.push(e.text); return { isFilled: true } })

      await (await $.ui.mount({ ...BAND, surface })).press({ key: 'punkte' })
      const ui = await $.ui.mount({ ...PANE, surface })

      expect(await ui.find({ text: /Testvorhaben/ })).toBeDefined()
      expect(await ui.find({ text: /Alte Zeile/ })).toBeUndefined()
      await ui.press({ key: 'b0-paket-0' })
      expect(gefuellt).toEqual(['Nimm dir aus der AUFTRAG.md das Paket P-1 „Auswahl ansehen“ vor und arbeite es bis zum Erfolgskriterium ab.'])
    })
  }

  // Seit 18.10.2026: ein Block je Auftragsdatei
  const ZWEITER = '# Pruefung einer Kundin\n\n## Offen\n\n- **Seite 12 nachfragen:** Zitat ohne Quelle.\n\n## Pakete\n\n### K-1 · Bericht bauen\n\n- **Stand:** offen\n'
  const LEER = '# Alles erledigt\n\n## Pakete\n\n### X-1 · Fertig\n\n- **Stand:** erledigt 01.10.2026\n'
  const DATEIEN = [
    { pfad: 'C:\\Projekt\\skill\\AUFTRAG.md', name: 'skill\\AUFTRAG.md', ordner: 'C:\\Projekt\\skill', content: AUFTRAG, mtimeMs: 100 },
    { pfad: 'C:\\Kundin\\AUFTRAG.md', name: 'C:\\Kundin\\AUFTRAG.md', ordner: 'C:\\Kundin', content: ZWEITER, mtimeMs: 200 },
    { pfad: 'C:\\Projekt\\eval\\AUFTRAG_alt.md', name: 'eval\\AUFTRAG_alt.md', ordner: 'C:\\Projekt\\eval', content: LEER, mtimeMs: 300 },
    { pfad: 'C:/Projekt/skill/AUFTRAG.md', name: 'doppelt', ordner: 'C:\\Projekt\\skill', content: AUFTRAG, mtimeMs: 100 },
  ]

  test('ordnet Bloecke: zuletzt geaendert oben, ohne offene Punkte ausgeblendet, doppelte einmal', () => {
    const { bloecke, ohne } = ordneBloecke(DATEIEN)
    expect(bloecke.map(b => b.titel)).toEqual(['Pruefung einer Kundin', 'Testvorhaben'])
    expect(ohne).toBe(1)
    expect(bloecke[1]?.liste[0]?.prompt).toBe('Nimm dir aus der skill\\AUFTRAG.md das Paket P-1 „Auswahl ansehen“ vor und arbeite es bis zum Erfolgskriterium ab.')
  })

  test('Panel zeigt je Datei einen Block, der zweite ist zu und klappt mit einem Klick auf', MIT_PANEL, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    mock.store(on, { 'auftraege-test': DATEIEN })
    on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
    await (await $.ui.mount({ ...BAND, surface: 'desktop' })).press({ key: 'punkte' })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ text: /Seite 12 nachfragen/ })).toBeDefined()
    expect(await ui.find({ text: /Auswahl ansehen/ })).toBeUndefined()
    expect(await ui.find({ text: /1 weitere Auftragsdatei ohne offene Punkte/ })).toBeDefined()
    await ui.press({ key: 'b1-kopf' })
    expect(await ui.find({ text: /Auswahl ansehen/ })).toBeDefined()
    await ui.press({ key: 'b0-kopf' })
    expect(await ui.find({ text: /Seite 12 nachfragen/ })).toBeUndefined()
  })

  test('ohne AUFTRAG.md sagt das Panel das', MIT_PANEL, async ($, on) => {
    on('ui.open', () => ({ value: { isPlaced: true } }))
    mock.store(on, {})
    await (await $.ui.mount({ ...BAND, surface: 'desktop' })).press({ key: 'punkte' })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ text: /Keine AUFTRAG.md/ })).toBeDefined()
  })
})
