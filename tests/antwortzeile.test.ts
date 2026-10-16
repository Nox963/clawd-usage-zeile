import { expect, mock, test } from 'claude-code/testing'

import { beitrag, dauer, VERBEN } from '../hooks/antwortzeile'

// Die Sitzung, wie der Mod sie misst: Kontext nach der letzten Anfrage und die Schaetzung
// nach dem Verdichten.
type Zustand = { tokens?: number; geschaetzt: number }
// Eine Nachricht, wie sie nach dem Verdichten als Zusammenfassung dasteht
const NACHRICHT = { role: 'user' as const, text: 'Zusammenfassung', toolUses: [] }

async function starte($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1],
  z: Zustand) {
  mock.store(on, { 'szenen-test': {} })
  mock.clock(on, { now: Date.parse('2026-10-15T08:00:00Z') })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.compact', () => { z.tokens = undefined; return { messages: [NACHRICHT] } })
  on('session.usage', (_$, e) => ({ value: {
    startedAt: 0,
    context: {
      window: 1_000_000,
      ...(z.tokens === undefined ? {} : { tokens: z.tokens }),
      ...((e as { breakdown?: string } | undefined)?.breakdown
        ? { breakdown: { categories: [], totalTokens: z.geschaetzt, autoCompactThreshold: 967_000, isAutoCompactEnabled: true } }
        : {}),
    },
    rateLimits: [],
  } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  // So zeichnet die App einen Antwortblock: sein Text, sonst nichts
  on('ui.render', { component: 'AssistantMessage' }, (_$, e) => ({ type: 'Text' as const, children: [e.props.text] }))
  await $.session.start({ cwd: '.', surface: 'desktop', isInteractive: true })
}

// Der letzte Textblock einer Antwort, wie die App ihn zeichnet
async function zeileUnter($: Parameters<Parameters<typeof test>[1]>[0], text: string, surface: 'desktop' | 'terminal' = 'desktop') {
  const ui = await $.ui.mount({ plugin: 'usage-zeile', surface, component: 'AssistantMessage',
    props: { text, isFirstOfReply: true } })
  const z = await ui.find({ text: /^Claude / })
  await ui.unmount()
  return z === undefined ? undefined : String((z as { text?: string }).text ?? '')
}

const ANTWORT = { answer: 'Fertig.', durationMs: 184_000, isAborted: false, turnId: 't1', reason: 'answer' as const }
const ZEILE = new RegExp(`^Claude (${VERBEN.join('|')}) for 3m 4s · \\+8,4k$`)

test('unter dem letzten Textblock stehen Verb, Dauer und Beitrag zum Kontext', async ($, on) => {
  const z: Zustand = { tokens: 100_000, geschaetzt: 0 }
  await starte($, on, z)
  await $.turn.start({ text: 'los', turnId: 't1' })
  // 108.400 gemessen plus "Fertig." (7 Zeichen ≈ 2 Tokens) minus 100.000
  z.tokens = 108_400
  const r = await $.turn.complete(ANTWORT)
  // der Text der Antwort bleibt, es kommt kein eingeklappter Hinweis dazu
  expect(r.text).toBe('Fertig.')
  expect(await zeileUnter($, 'Fertig.')).toMatch(ZEILE)
  // in Claude-Orange aus dem Farbschema, mit einer Leerzeile Abstand zur Antwort
  const ui = await $.ui.mount({ plugin: 'usage-zeile', surface: 'desktop', component: 'AssistantMessage',
    props: { text: 'Fertig.', isFirstOfReply: true } })
  expect(((await ui.find({ type: 'Text', text: /^Claude / }))?.props as { color?: string } | undefined)?.color).toBe('claude')
  // das Verb steht kursiv, und nur das Verb
  const kursiv = (await ui.findAll({ type: 'Text' })).filter(t => (t.props as { italic?: boolean }).italic)
  expect(kursiv.length).toBe(1)
  expect(VERBEN).toContain(String((kursiv[0] as { text?: string } | undefined)?.text))
  const kaesten = await ui.findAll({ type: 'Box' })
  expect(kaesten.some(k => (k.props as { marginTop?: number }).marginTop === 1)).toBe(true)
  await ui.unmount()
  // andere Bloecke bekommen keine Zeile
  expect(await zeileUnter($, 'Ich lese die Datei.')).toBeUndefined()
})

test('ein langer Block wird an seinem Schluss erkannt, auch mit anderem Leerraum', async ($, on) => {
  const z: Zustand = { tokens: 100_000, geschaetzt: 0 }
  await starte($, on, z)
  const lang = 'Erster Absatz mit Inhalt. '.repeat(20) + '\n\nLetzter Satz der Antwort.'
  await $.turn.start({ text: 'los', turnId: 't1' })
  z.tokens = 101_000
  await $.turn.complete({ ...ANTWORT, answer: lang })
  expect(await zeileUnter($, lang.replace(/\n\n/g, '\n'))).toMatch(/^Claude .* for 3m 4s · \+/)
})

test('die naechste Antwort rechnet ab dem Stand nach der vorigen, nicht ab der Messung beim Start', async ($, on) => {
  const z: Zustand = { tokens: 100_000, geschaetzt: 0 }
  await starte($, on, z)
  await $.turn.start({ text: 'los', turnId: 't1' })
  z.tokens = 108_400
  await $.turn.complete(ANTWORT)                 // danach gilt 108.402
  await $.turn.start({ text: 'weiter', turnId: 't2' })
  z.tokens = 120_400
  await $.turn.complete({ ...ANTWORT, answer: 'Weiter.', turnId: 't2', durationMs: 12_000 })
  expect(await zeileUnter($, 'Weiter.')).toMatch(/ for 12s · \+12k$/)
  // die Zeile der ersten Antwort bleibt stehen
  expect(await zeileUnter($, 'Fertig.')).toMatch(ZEILE)
})

test('nach dem Verdichten waehrend der Antwort steht "verdichtet" statt einer Zahl', async ($, on) => {
  const z: Zustand = { tokens: 900_000, geschaetzt: 41_000 }
  await starte($, on, z)
  await $.turn.start({ text: 'los', turnId: 't1' })
  await $.session.compact({ trigger: 'auto', messages: [NACHRICHT, NACHRICHT] })
  z.tokens = 60_000
  await $.turn.complete(ANTWORT)
  expect(await zeileUnter($, 'Fertig.')).toMatch(/ for 3m 4s · verdichtet$/)
  // die Antwort danach rechnet wieder ab dem neuen Stand
  await $.turn.start({ text: 'weiter', turnId: 't2' })
  z.tokens = 61_498
  await $.turn.complete({ ...ANTWORT, answer: 'Weiter.', turnId: 't2' })
  expect(await zeileUnter($, 'Weiter.')).toMatch(/ · \+1,5k$/)
})

test('nach /compact zwischen zwei Antworten zaehlt ab der Schaetzung', async ($, on) => {
  const z: Zustand = { tokens: 900_000, geschaetzt: 41_000 }
  await starte($, on, z)
  await $.session.compact({ trigger: 'manual', messages: [NACHRICHT, NACHRICHT] })
  await $.turn.start({ text: 'los', turnId: 't1' })
  z.tokens = 44_998
  await $.turn.complete(ANTWORT)
  expect(await zeileUnter($, 'Fertig.')).toMatch(/ · \+4k$/)
})

test('keine Zeile bei Subagenten, nach Abbruch und im Terminal', async ($, on) => {
  const z: Zustand = { tokens: 100_000, geschaetzt: 0 }
  await starte($, on, z)
  await $.turn.start({ text: 'los', turnId: 't1' })
  z.tokens = 108_400
  await $.turn.complete({ ...ANTWORT, answer: 'Subagent fertig.', agentId: 'a1' })
  expect(await zeileUnter($, 'Subagent fertig.')).toBeUndefined()
  await $.turn.complete({ ...ANTWORT, answer: 'Abgebrochen.', reason: 'aborted', isAborted: true })
  expect(await zeileUnter($, 'Abgebrochen.')).toBeUndefined()
  await $.turn.complete(ANTWORT)
  expect(await zeileUnter($, 'Fertig.', 'terminal')).toBeUndefined()
  expect(await zeileUnter($, 'Fertig.')).toBeDefined()
})

test('Dauer und Beitrag sind so geschrieben wie verlangt', async () => {
  expect(dauer(9_400)).toBe('9s')
  expect(dauer(184_000)).toBe('3m 4s')
  expect(dauer(3_725_000)).toBe('1h 2m')
  expect(beitrag(850)).toBe('+850')
  expect(beitrag(8_400)).toBe('+8,4k')
  expect(beitrag(12_400)).toBe('+12k')
  expect(beitrag(1_250_000)).toBe('+1,3M')
  expect(beitrag(-1_200)).toBe('−1,2k')
})
