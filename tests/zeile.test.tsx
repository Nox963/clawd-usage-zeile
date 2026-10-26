import { expect, mock, test } from 'claude-code/testing'

import { blaettere, teile } from '../hooks/register'

const BAND = {
  plugin: 'usage-zeile',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

// Kleine Testszenen statt der echten Dateien: ein Test hat keinen Zugriff auf die Platte.
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>'
function szene(key: string, titel: string, nr?: number, hoehe = 75) {
  return { key, titel, text: 'tut etwas', handlung: key === 'quietsche' ? 'fängt einen Käfer mit dem Glas' : '',
    svg: SVG, breite: 150, hoehe, vorschau: SVG, vbreite: 90, vhoehe: 70, ...(nr === undefined ? {} : { nr }) }
}
// Eine Szene mit Animation, gebaut wie die echten: das Bild ist versteckt und wird eingeblendet
const BEWEGT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><svg x="2" visibility="hidden">'
  + '<animate attributeName="visibility" calcMode="discrete" dur="2s" keyTimes="0;0.5" values="visible;hidden"/>'
  + '<animate attributeName="x" calcMode="discrete" dur="2s" keyTimes="0;0.5" values="4;6"/></svg></svg>'
// Der Ordner szenen\ als { Dateiname: Inhalt }. Der Mod liest ihn im Test aus dem Speicher.
const ORDNER: Record<string, string> = {
  'neu.json': JSON.stringify(szene('neu', 'Neue Szene')),   // aus der Skill, ohne Nummer: ans Ende
  'koch.json': JSON.stringify({ ...szene('koch', 'Koch', 0), svg: BEWEGT }),
  'pur.json': JSON.stringify(szene('pur', 'Pur', 1, 63)),
  'quietsche.json': JSON.stringify(szene('quietsche', 'Quietscheente', 2)),
  'kaputt.json': '{ kein json',
  'notiz.txt': 'keine Szene',
}

// Die Grafiken der Zeile ausser dem Kontext-Kreis: Clawd oben oder die Karten der Auswahl
type Gezeichnet = { findAll: (q: { type: string }) => Promise<{ props: unknown }[]> }
async function clawds(ui: Gezeichnet) {
  return (await ui.findAll({ type: 'Svg' })).filter(x => (x.props as { alt?: string }).alt !== 'Kontext')
}

// Eine Nachricht, wie sie nach dem Verdichten als Zusammenfassung dasteht
const NACHRICHT = { role: 'user' as const, text: 'Zusammenfassung', toolUses: [] }

async function starte($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1],
  limits: { kind: string; percentUsed: number; resetsAt?: string }[] = [{ kind: 'five_hour', percentUsed: 23.5 }, { kind: 'seven_day', percentUsed: 81 }],
  speicher: Record<string, unknown> = {}, zustand = { verdichtet: false }) {
  mock.store(on, { 'szenen-test': ORDNER, ...speicher })
  const uhr = mock.clock(on, { now: Date.parse('2026-10-14T12:00:00Z') })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  // Nach dem Verdichten meldet die Sitzung keine Kontextzahl, nur die Schaetzung wie /context
  on('session.compact', () => { zustand.verdichtet = true; return { messages: [NACHRICHT] } })
  on('session.usage', (_$, e) => ({ value: {
    startedAt: 0,
    context: {
      window: 1_000_000,
      ...(zustand.verdichtet ? {} : { tokens: 785_000, percent: 79 }),
      ...((e as { breakdown?: string } | undefined)?.breakdown ? { breakdown: {
        categories: [],
        totalTokens: zustand.verdichtet ? 41_000 : 790_000,
        autoCompactThreshold: 967_000,
        isAutoCompactEnabled: true,
      } } : {}),
    },
    rateLimits: limits,
  } }))
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
  return uhr
}

test('Zeile zeigt Limits, Kontext, Schalter und Auswahlpunkt', async ($, on) => {
  await starte($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ text: /🕖/ })).toBeDefined()
    expect(await ui.find({ text: /23,5.%/ })).toBeDefined()
    expect(await ui.find({ text: /785k\/1M/ })).toBeDefined()
    expect(await ui.find({ key: 'schalter' })).toBeDefined()
    expect(await ui.find({ key: 'punkt' })).toBeDefined()
    expect(await ui.find({ text: /\$/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('Clawd erscheint als Grafik nur auf dem Desktop, immer 28 Pixel hoch', async ($, on) => {
  await starte($, on)
  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const [svg] = await clawds(desk)
  expect(svg).toBeDefined()
  expect((svg?.props as { height?: number } | undefined)?.height).toBe(28)
  await desk.unmount()
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  await term.unmount()
})

test('der Schalter blendet Zahlen und Clawd aus und wieder ein', async ($, on) => {
  await starte($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'schalter' })
  expect(await ui.find({ text: /🕖/ })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ key: 'schalter' })).toBeDefined()
  await ui.press({ key: 'schalter' })
  expect(await ui.find({ text: /🕖/ })).toBeDefined()
  await ui.unmount()
})

test('der Punkt klappt die Auswahl in der Zeile auf, mit jeder lesbaren Szene aus dem Ordner', async ($, on) => {
  await starte($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'punkt' })
  // vier lesbare Szenen, die kaputte Datei und die Notiz fallen weg; Clawd oben ruht
  expect((await clawds(ui)).length).toBe(4)
  expect(await ui.find({ text: /^Tut etwas\.$/ })).toBeDefined()
  const knoepfe = (await ui.findAll({ type: 'Button' })).map(k => k.key).filter(k => k?.startsWith('wahl-'))
  expect(knoepfe).toEqual(['wahl-koch', 'wahl-pur', 'wahl-quietsche', 'wahl-neu'])
  // Abspielen zeigt auf genau einer Karte den ganzen Ablauf
  await ui.press({ key: 'spiel-quietsche' })
  const ganz = (await ui.findAll({ type: 'Svg' })).filter(x => /ganzer Ablauf/.test(String((x.props as { alt?: string }).alt)))
  expect(ganz.length).toBe(1)
  // Auswaehlen uebernimmt die Szene und klappt die Auswahl wieder zu
  await ui.press({ key: 'wahl-pur' })
  expect(await ui.find({ key: 'wahl-koch' })).toBeUndefined()
  const [svg] = await clawds(ui)
  expect((svg?.props as { alt?: string } | undefined)?.alt).toBe('Clawd: Pur')
  await ui.unmount()
})

test('ein zweiter Klick auf den Punkt klappt die Auswahl wieder zu', async ($, on) => {
  await starte($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'punkt' })
  expect(await ui.find({ key: 'wahl-koch' })).toBeDefined()
  await ui.press({ key: 'punkt' })
  expect(await ui.find({ key: 'wahl-koch' })).toBeUndefined()
  expect((await clawds(ui)).length).toBe(1)
  await ui.unmount()
})

test('hinter den Prozenten steht nur die Restzeit, bei der Woche in Tagen und Stunden', async ($, on) => {
  await starte($, on, [
    { kind: 'five_hour', percentUsed: 5, resetsAt: '2026-10-14T16:07:00Z' },
    { kind: 'seven_day', percentUsed: 23, resetsAt: '2026-10-18T22:00:00Z' },
  ])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ text: /\(4.h.7.min\)/ })).toBeDefined()
  expect(await ui.find({ text: /\(4.Tage.10.h\)/ })).toBeDefined()
  expect(await ui.find({ text: /Reset/ })).toBeUndefined()
  await ui.unmount()
})

test('ein Klick auf 🕖 oder 📆 zeigt die Uhrzeit des Resets, ein zweiter die Restzeit', async ($, on) => {
  await starte($, on, [
    { kind: 'five_hour', percentUsed: 5, resetsAt: '2026-10-14T16:07:00Z' },
    { kind: 'seven_day', percentUsed: 23, resetsAt: '2026-10-19T08:00:00Z' },
  ])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'limit-five_hour' })
  expect(await ui.find({ text: /\(bis.\d\d:\d\d\)/ })).toBeDefined()
  expect(await ui.find({ text: /\(4.h.7.min\)/ })).toBeUndefined()
  await ui.press({ key: 'limit-seven_day' })
  expect(await ui.find({ text: /\(bis.Mo.\d\d:\d\d\)/ })).toBeDefined()
  await ui.press({ key: 'limit-five_hour' })
  expect(await ui.find({ text: /\(4.h.7.min\)/ })).toBeDefined()
  await ui.unmount()
})

test('ein Klick auf den Kontext zeigt, wann Autocompact laeuft', async ($, on) => {
  await starte($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'kontext' })
  // Schwelle 967k, gefuellt 785k: noch 182k
  expect(await ui.find({ text: /Autocompact.bei/ })).toBeDefined()
  expect(await ui.find({ text: /^967k$/ })).toBeDefined()
  expect(await ui.find({ text: /noch.182k/ })).toBeDefined()
  expect(await ui.find({ text: /785k\/1M/ })).toBeUndefined()
  await ui.press({ key: 'kontext' })
  expect(await ui.find({ text: /785k\/1M/ })).toBeDefined()
  await ui.unmount()
})

test('nach /compact zeigt die Zeile den geschaetzten neuen Kontext, nicht den alten', async ($, on) => {
  await starte($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ text: /785k\/1M/ })).toBeDefined()
  await $.session.compact({ trigger: 'manual', messages: [NACHRICHT, NACHRICHT] })
  expect(await ui.find({ text: /785k\/1M/ })).toBeUndefined()
  expect(await ui.find({ text: /≈41k\/1M/ })).toBeDefined()
  expect(await ui.find({ text: /\(4.%\)/ })).toBeDefined()
  // die Limits bleiben dabei stehen
  expect(await ui.find({ text: /23,5.%/ })).toBeDefined()
  await ui.unmount()
})

test('der Kontext-Kreis steht anstelle des Worts und fuellt sich in Orange', async ($, on) => {
  await starte($, on)
  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const kreis = (await desk.findAll({ type: 'Svg' })).find(x => (x.props as { alt?: string }).alt === 'Kontext')
  const quelle = String((kreis?.props as { source?: string } | undefined)?.source)
  expect(quelle).toContain('#D97757')
  // 79 % eines Umfangs von 2·π·5,5 ≈ 34,56 sind ≈ 27,30
  expect(quelle).toContain('stroke-dasharray="27.30 34.56"')
  expect(await desk.find({ text: /^Kontext/ })).toBeUndefined()
  await desk.unmount()
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await term.find({ text: /Kontext/ })).toBeDefined()
  await term.unmount()
})

test('ohne frische Angabe bleiben die zuletzt bekannten Limits stehen', async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  // neue Sitzung: der Server hat noch nichts gemeldet, der Speicher kennt die Limits
  await starte($, on, [], { limits: [
    { kind: 'five_hour', percentUsed: 14, resetsAt: '2026-10-14T22:10:00Z' },
    { kind: 'seven_day', percentUsed: 25, resetsAt: '2026-10-10T08:00:00Z' },   // schon vorbei
  ] })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ text: /14.%/ })).toBeDefined()
  expect(await ui.find({ text: /25.%/ })).toBeUndefined()
  expect(await ui.find({ text: /keine.Angabe/ })).toBeUndefined()
  // eine Messung ohne Limits nach einer Antwort ersetzt sie nicht
  await $.session.measure({ context: { window: 1_000_000, tokens: 482_000, percent: 48 }, rateLimits: [], changed: ['context'] })
  expect(await ui.find({ text: /14.%/ })).toBeDefined()
  expect(await ui.find({ text: /482k\/1M/ })).toBeDefined()
  await ui.unmount()
})

test('ein Stern macht eine Szene zum Favoriten, der zuletzt markierte steht ganz oben', async ($, on) => {
  await starte($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'punkt' })
  const reihe = async () => (await ui.findAll({ type: 'Button' })).map(k => k.key).filter(k => k?.startsWith('wahl-'))
  expect(await reihe()).toEqual(['wahl-koch', 'wahl-pur', 'wahl-quietsche', 'wahl-neu'])
  expect(await ui.find({ text: /★/ })).toBeUndefined()
  await ui.press({ key: 'stern-quietsche' })
  await ui.press({ key: 'stern-neu' })
  expect(await reihe()).toEqual(['wahl-neu', 'wahl-quietsche', 'wahl-koch', 'wahl-pur'])
  // ein zweiter Klick nimmt den Stern weg, die Szene geht an ihren alten Platz
  await ui.press({ key: 'stern-neu' })
  expect(await reihe()).toEqual(['wahl-quietsche', 'wahl-koch', 'wahl-pur', 'wahl-neu'])
  // die Favoriten bleiben ueber Zuklappen und Aufklappen erhalten
  await ui.press({ key: 'punkt' })
  await ui.press({ key: 'punkt' })
  expect(await reihe()).toEqual(['wahl-quietsche', 'wahl-koch', 'wahl-pur', 'wahl-neu'])
  await ui.unmount()
})

test('der Clawd in der Zeile steht still und bewegt sich nur, solange Claude arbeitet', async ($, on) => {
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  // eine Modellanfrage ohne Inhalt: der Strom endet sofort
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  const uhr = await starte($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const quelle = async () => String(((await clawds(ui))[0]?.props as { source?: string } | undefined)?.source)
  // Standbild: keine Animation, jedes bewegte Attribut auf seinem ersten Wert
  expect(await quelle()).not.toContain('<animate')
  expect(await quelle()).toContain('<svg x="4" visibility="visible">')
  await $.turn.start({ text: 'los', turnId: 't1' })
  expect(await quelle()).toContain('<animate attributeName="visibility"')
  await $.turn.complete({ answer: 'Fertig.', durationMs: 3_000, isAborted: false, turnId: 't1', reason: 'answer' as const })
  expect(await quelle()).not.toContain('<animate')
  // ein Subagent, der nach der Antwort weiterarbeitet, bewegt ihn auch, bis er fertig ist
  for await (const _ of $.turn.step({ turnId: 'a1', index: 0, model: 'm', messageCount: 1, agentId: 'a1' })) { /* leer */ }
  await uhr.settle()
  expect(await quelle()).toContain('<animate attributeName="visibility"')
  await $.turn.complete({ answer: 'Agent fertig.', durationMs: 3_000, isAborted: false, turnId: 'a1', reason: 'answer' as const, agentId: 'a1' })
  expect(await quelle()).not.toContain('<animate')
  await ui.unmount()
})

test('die Auswahl zeigt drei flache Karten je Reihe', async ($, on) => {
  await starte($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'punkt' })
  const karten = (await ui.findAll({ type: 'Box' })).filter(b => String(b.key ?? '').startsWith('karte-'))
  expect(karten.length).toBe(4)
  const breite = (karten[0]?.props as { width?: number; flexDirection?: string } | undefined)
  expect(breite?.flexDirection).toBe('row')
  expect(3 * (breite?.width ?? 999) + 2).toBeLessThanOrEqual(BAND.props.bodyColumns)
  // kurz steht nur, was Clawd tut; die Handlung erst beim Abspielen
  expect(await ui.find({ text: /Zwischendurch/ })).toBeUndefined()
  await ui.press({ key: 'spiel-quietsche' })
  expect(await ui.find({ text: /Zwischendurch fängt einen Käfer/ })).toBeDefined()
  await ui.unmount()
})

test('das Mausrad blaettert die Karten reihenweise, die Kopfzeile bleibt', async () => {
  // 13 Reihen: eine Reihe je Drehung, nicht unter 0, nicht ueber die vorletzte Reihe
  expect(blaettere(0, 1, 13)).toBe(1)
  expect(blaettere(0, 3, 13)).toBe(1)
  expect(blaettere(0, -1, 13)).toBe(0)
  expect(blaettere(11, 1, 13)).toBe(11)
  expect(blaettere(5, -2, 13)).toBe(4)
  expect(blaettere(0, 1, 2)).toBe(0)
  expect(blaettere(4, 0, 13)).toBe(4)
})

test('jeder Teil ist an, bis seine Einstellung ausdruecklich false ist', async () => {
  expect(teile(undefined)).toEqual({ zahlen: true, clawd: true, antwortzeile: true, panel: true })
  expect(teile({ clawd: false, panel: false })).toEqual({ zahlen: true, clawd: false, antwortzeile: true, panel: false })
  expect(teile({ zahlen: 'nein' })).toEqual({ zahlen: true, clawd: true, antwortzeile: true, panel: true })
})

test('abgeschaltete Teile fehlen in der Zeile', { options: { clawd: false, panel: false } }, async ($, on) => {
  await starte($, on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ text: /🕖/ })).toBeDefined()
  expect((await clawds(ui)).length).toBe(0)
  expect(await ui.find({ key: 'punkt' })).toBeUndefined()
  expect(await ui.find({ key: 'punkte' })).toBeUndefined()
  await ui.unmount()
})
