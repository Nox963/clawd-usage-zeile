import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Messung, Szene } from '../types'
import { antwortzeile } from './antwortzeile'

const messung = atom({ plugin: 'usage-zeile', key: 'messung' } as const, null)
const jetzt = atom({ plugin: 'usage-zeile', key: 'jetzt' } as const, 0)
const an = atom({ plugin: 'usage-zeile', key: 'an' } as const, true)
const clawd = atom({ plugin: 'usage-zeile', key: 'clawd' } as const, 'koch')
// Die Szenen liegen als JSON-Dateien im Ordner szenen\ neben diesem Mod. Eine neue Datei
// dort ist beim naechsten Oeffnen der Auswahl waehlbar, ohne Aenderung am Mod.
const szenen = atom({ plugin: 'usage-zeile', key: 'szenen' } as const, [])

// Die Auswahl klappt in der Zeile selbst auf, nicht als eigenes Fenster. Ein Fenster liess
// sich im Vollbild nicht sauber schliessen: nach dem Kreuz blieb eine weisse Flaeche
// stehen (Fehler der App, 14.10.2026). Die Zeile waechst dafuer bis zur halben
// Fensterhoehe und rollt.
const auswahlOffen = atom({ plugin: 'usage-zeile', key: 'auswahlOffen' } as const, false)
// Die Karten zeigen die Arbeit der Szene, leicht genug fuer alle auf einmal. Den ganzen
// Ablauf mit Handlung spielt immer nur eine Karte, auf Knopfdruck. Alle 23 Ablaeufe auf
// einmal (gut 300 KB) zeichnete die Desktop-App nicht.
const spielt = atom({ plugin: 'usage-zeile', key: 'spielt' } as const, '')
// Favoriten: ein Stern oben rechts auf jeder Karte. Favoriten stehen oben in der Auswahl,
// der zuletzt markierte ganz oben (Wunsch des Nutzers, 15.10.2026). Die Liste haelt die
// Schluessel der Szenen, neuester zuerst.
const favoriten = atom({ plugin: 'usage-zeile', key: 'favoriten' } as const, [])
// Dieselben zwei Werte wie in antwortzeile.ts. Sie stehen hier ein zweites Mal, weil der Mod
// einen Wert nur ueber eine Bezeichnung aus derselben Datei schreiben darf. Gesetzt werden
// sie hier nur nach dem Verdichten, denn session.compact darf nur einmal angemeldet sein.
const vorher = atom({ plugin: 'usage-zeile', key: 'vorher' } as const, null)
const verdichtet = atom({ plugin: 'usage-zeile', key: 'verdichtet' } as const, false)
// Die Karten sind seit 15.10.2026 flach: Vorschau links, rechts Titel, kurzer Text und Knoepfe,
// drei Karten nebeneinander, sechs ohne Rollen sichtbar (Wunsch des Nutzers). Vorher stand die
// Vorschau ueber dem Text, nur zwei Karten passten nebeneinander. Die Vorschauen sind fest so
// hoch, der ganze Ablauf beim Abspielen ebenso.
const VORSCHAU_HOEHE = 34     // Pixel
const KARTEN_JE_REIHE = 3

// Der Clawd in der Usage-Zeile bewegt sich nur, solange Claude arbeitet (gesetzt in
// antwortzeile.tsx). Sonst zeigt er das erste Bild seiner Szene als Standbild.
const arbeitet = atom({ plugin: 'usage-zeile', key: 'arbeitet' } as const, false)
// Laufende Subagenten (gesetzt in antwortzeile.tsx). Einer, dessen letzte Anfrage laenger als
// AGENT_STILL her ist, zaehlt nicht mehr, falls sein Ende nie gemeldet wurde.
const agenten = atom({ plugin: 'usage-zeile', key: 'agenten' } as const, {})
const AGENT_STILL = 10 * 60_000

// Bei offener Auswahl bleibt die oberste Zeile stehen, das Mausrad blaettert die Karten
// (Wunsch des Nutzers, 15.10.2026). Die App rollt nur die ganze Zeile, darum faengt der Mod
// das Rad ab (ui.scroll), blaettert selbst eine Kartenreihe je Drehung und haelt das Fenster
// der App auf Zeile 1. Ueber der Kopfzeile liegt dafuer eine leere Zeile: Stuende das Fenster
// auf Zeile 0, meldete die App kein Rollen nach oben (erste Fassung, nach oben blockiert).
const kartenStart = atom({ plugin: 'usage-zeile', key: 'kartenStart' } as const, 0)

// Neue erste Kartenreihe nach einer Raddrehung um `by` Zeilen: eine Reihe je Drehung, nie
// ueber die vorletzte Reihe hinaus, damit unten immer noch Karten stehen
export function blaettere(start: number, by: number, reihen: number): number {
  if (by === 0) return start
  return Math.min(Math.max(0, reihen - 2), Math.max(0, start + Math.sign(by)))
}

// Standbild einer Szene: Jede Animation der Szenen sitzt direkt hinter dem Element, das sie
// bewegt, und schaltet nur visibility oder verschiebt x (alle 38 Szenen geprueft am
// 15.10.2026). Das Standbild setzt jedes so bewegte Attribut auf den ersten Wert der
// Animation und laesst die Animation weg. Das ergibt das erste Bild der Szene.
const standbilder = new Map<string, string>()
export function standbild(svg: string): string {
  const fertig = standbilder.get(svg)
  if (fertig !== undefined) return fertig
  const still = svg.replace(/<(\w+)((?:\s[^<>]*?)?)>((?:<animate\b[^<>]*\/>)+)/g, (_g, tag: string, attrs: string, animationen: string) => {
    let a = attrs
    for (const [, name, werte] of animationen.matchAll(/<animate\b[^<>]*?attributeName="(\w+)"[^<>]*?values="([^"]*)"[^<>]*\/>/g)) {
      const erster = werte.split(';')[0] ?? ''
      const muster = new RegExp(`(\\s${name}=")[^"]*(")`)
      a = muster.test(a) ? a.replace(muster, `$1${erster}$2`) : `${a} ${name}="${erster}"`
    }
    return `<${tag}${a}>`
  })
  standbilder.set(svg, still)
  return still
}
// Ein Klick auf eine der drei Anzeigen schaltet zwischen Kurzform und Details um:
// 🕖 und 📆 zeigen dann die Uhrzeit des Resets, der Kontext, wann Autocompact laeuft.
// Bis 14.10.2026 zeigte der Kontext hier seine Aufteilung wie /context; der Nutzer wollte
// stattdessen die Schwelle des Autocompact.
const ansicht = atom({ plugin: 'usage-zeile', key: 'ansicht' } as const, { fuenf: false, woche: false, kontext: false })
// Schwelle des Autocompact in Tokens, null solange unbekannt, 0 wenn er aus ist
const schwelle = atom({ plugin: 'usage-zeile', key: 'schwelle' } as const, null)
// Der eigene Kontext-Kreis steht anstelle des Worts Kontext. Grafiken folgen dem hellen
// und dunklen Modus nicht, darum ein Grau fuer den Ring, das in beiden traegt, und das
// Orange von Claude fuer den Fuellstand.
const KREIS_ORANGE = '#D97757'
const KREIS_GRAU = '#9c9a92'
// Clawd in der Zeile ist immer gleich hoch, jede Szene wird darauf verkleinert. Hohe
// Szenen (Sprechblasen, Spruenge) werden dabei kleiner als niedrige. Gewaehlt am
// 14.10.2026, damit die Zeile kaum hoeher ist als eine Textzeile.
const CLAWD_HOEHE = 28        // Pixel
// Eigener Rand um die Zeile. Den grauen Grund darunter zeichnet die App selbst, ein Mod
// kann ihn nicht entfernen. In der Desktop-App kostet der Rand oben und unten je eine
// Textzeile Hoehe.
const RAND = false            // 14.10.2026: Rand weg, die Zeile wird so flacher
const NBSP = '\u00a0'        // geschuetztes Leerzeichen: hier bricht die Zeile nie um




const NAMEN: Record<string, string> = {
  five_hour: '🕖',
  seven_day: '📆',
  spend_limit: 'Ausgabenlimit',
}

function alsMessung(f: { rateLimits: SessionRateLimit[]; context: SessionContextUsage }): Messung {
  return {
    limits: f.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    kontextTokens: f.context.tokens,
    kontextFenster: f.context.window,
    kontextProzent: f.context.percent,
  }
}

// Nach /compact, /clear oder einem frischen Start meldet die Sitzung keine Kontextzahl, bis
// die naechste Antwort da ist. Dann schaetzt der Mod sie lokal wie /context (ohne Anfrage an
// den Server). Die Zeile zeigt sie mit ≈. Ohne das blieb am 14.10.2026 nach /compact die
// alte Zahl (919k) stehen.
async function schaetzeKontext($: EngineInterface, neu: Messung) {
  if (neu.kontextTokens !== undefined) return
  try {
    const b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
    if (b === undefined) return
    neu.kontextTokens = b.totalTokens
    neu.kontextProzent = Math.round((b.totalTokens / neu.kontextFenster) * 100)
    neu.geschaetzt = true
    await merkeSchwelle($, b)
  } catch {
    // keine Schaetzung moeglich: die Zeile zeigt –/1M
  }
}

async function merkeSchwelle($: EngineInterface, b: { autoCompactThreshold?: number; isAutoCompactEnabled: boolean }) {
  const wert = b.isAutoCompactEnabled && b.autoCompactThreshold !== undefined ? b.autoCompactThreshold : 0
  await update($, schwelle, () => wert)
}

// Restzeit bis zum Zuruecksetzen, grob genug fuer eine Statuszeile. woche: ab einem Tag
// Rest Tage und Stunden ausgeschrieben (4 Tage 14 h), darunter Stunden und Minuten.
function restzeit(resetsAt: string | undefined, nun: number, woche = false): string | undefined {
  if (resetsAt === undefined || nun === 0) return undefined
  const ms = Date.parse(resetsAt) - nun
  if (Number.isNaN(ms)) return undefined
  if (ms <= 0) return 'gleich'
  const minuten = Math.floor(ms / 60000)
  const tage = Math.floor(minuten / 1440)
  const stunden = Math.floor((minuten % 1440) / 60)
  const rest = minuten % 60
  if (tage > 0) return woche ? `${tage}${NBSP}${tage === 1 ? 'Tag' : 'Tage'} ${stunden}${NBSP}h` : `${tage}${NBSP}T ${stunden}${NBSP}h`
  if (stunden > 0) return `${stunden}${NBSP}h ${rest}${NBSP}min`
  return `${rest}${NBSP}min`
}

function zahl(x: number | string): string {
  return String(x).replace('.', ',')
}

// 785000 → 785k, 1000000 → 1M, 1500000 → 1,5M
function kurz(tokens: number): string {
  if (tokens >= 1_000_000) return `${zahl(Math.round(tokens / 100_000) / 10)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return String(tokens)
}

// Ein Stueck der Zahlenzeile. Alle Leerzeichen darin sind geschuetzt, damit die
// Desktop-App die Zeile nicht mitten in einer Angabe umbricht.
type Stueck = { t: string; fett?: boolean; blass?: boolean }

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

// Uhrzeit des Resets in der Zeitzone des Rechners, mit Wochentag fuer das Wochenlimit
function uhrzeit(resetsAt: string | undefined, mitTag: boolean): string | undefined {
  if (resetsAt === undefined) return undefined
  const d = new Date(resetsAt)
  if (Number.isNaN(d.getTime())) return undefined
  const zeit = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return mitTag ? `${WOCHENTAGE[d.getDay()]}${NBSP}${zeit}` : zeit
}

// 🕖 5 % (4 h 7 min), mit Details 🕖 5 % (bis 00:10)
function limitStuecke(l: Messung['limits'][number], nun: number, details: boolean): Stueck[] {
  const woche = l.kind === 'seven_day'
  const klammer = details
    ? (() => { const u = uhrzeit(l.resetsAt, woche); return u === undefined ? undefined : `bis${NBSP}${u}` })()
    : restzeit(l.resetsAt, nun, woche)
  const aus: Stueck[] = [{ t: `${NAMEN[l.kind] ?? l.kind}${NBSP}` }, { t: `${zahl(l.percentUsed)}${NBSP}%`, fett: true }]
  if (klammer !== undefined) aus.push({ t: `${NBSP}(${klammer})`, blass: true })
  return aus
}

// 632k/1M (63 %), mit Details die Schwelle des Autocompact: Autocompact bei 967k (noch 335k)
function kontextStuecke(m: Messung, details: boolean, ab: number | null): Stueck[] {
  if (details) {
    if (ab === null) return [{ t: `Autocompact${NBSP}wird${NBSP}gelesen${NBSP}…`, blass: true }]
    if (ab === 0) return [{ t: `Autocompact${NBSP}aus`, fett: true }]
    const aus: Stueck[] = [{ t: `Autocompact${NBSP}bei${NBSP}` }, { t: kurz(ab), fett: true }]
    if (m.kontextTokens !== undefined) {
      const rest = ab - m.kontextTokens
      aus.push({ t: `${NBSP}(${rest > 0 ? `noch${NBSP}${m.geschaetzt ? '≈' : ''}${kurz(rest)}` : 'gleich'})`, blass: true })
    }
    return aus
  }
  const aus: Stueck[] = [{
    t: m.kontextTokens === undefined
      ? `–/${kurz(m.kontextFenster)}`
      : `${m.geschaetzt ? '≈' : ''}${kurz(m.kontextTokens)}/${kurz(m.kontextFenster)}`,
    fett: true,
  }]
  if (m.kontextProzent !== undefined) aus.push({ t: `${NBSP}(${m.kontextProzent}${NBSP}%)`, blass: true })
  return aus
}

// Ring, der sich mit dem Kontext fuellt, oben beginnend im Uhrzeigersinn
function kreis(prozent: number): string {
  const r = 5.5
  const umfang = 2 * Math.PI * r
  const voll = (Math.max(0, Math.min(100, prozent)) / 100) * umfang
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" width="14" height="14">`
    + `<circle cx="7" cy="7" r="${r}" fill="none" stroke="${KREIS_GRAU}" stroke-opacity="0.45" stroke-width="2.5"/>`
    + `<circle cx="7" cy="7" r="${r}" fill="none" stroke="${KREIS_ORANGE}" stroke-width="2.5" `
    + `stroke-dasharray="${voll.toFixed(2)} ${umfang.toFixed(2)}" transform="rotate(-90 7 7)"/></svg>`
}

function szeneZu(alle: Szene[], key: string): Szene | undefined {
  return alle.find(s => s.key === key) ?? alle[0]
}

function kurzText(sz: Szene): string {
  return `${sz.text.charAt(0).toUpperCase()}${sz.text.slice(1)}.`
}

function beschreibung(sz: Szene): string {
  const text = sz.text.charAt(0).toUpperCase() + sz.text.slice(1)
  return sz.handlung ? `${text}. Zwischendurch ${sz.handlung}.` : `${text}.`
}

// Keine festen Farben: Text ohne `color` und die Themenfarbe `text` folgen dem hellen
// oder dunklen Thema. Der Rand ist so schwarz im hellen und weiss im dunklen Modus.
export const register: Register = (on, options) => {
  // Die Zeile unter jeder Antwort (Dauer und Beitrag zum Kontext) steht in antwortzeile.ts
  antwortzeile(on, options)

  on('session.start', async ($, e, next) => {
    const ergebnis = await next(e)
    await stelleEin($)
    return ergebnis
  })


  on('session.measure', async ($, e, next) => {
    await setzeMessung($, e)
    return next(e)
  })

  // Nach dem Verdichten (/compact, Autocompact, ein Plugin) meldet session.measure nichts
  // Neues, bis die naechste Antwort kommt. Darum hier selbst neu messen. Eine Vorberechnung
  // (precompute) und das Verdichten eines Subagenten aendern den Kontext der Sitzung nicht.
  on('session.compact', async ($, e, next) => {
    const ergebnis = await next(e)
    if (e.trigger !== 'precompute' && e.agentId === undefined && ergebnis.skip === undefined) {
      // Ein Fehler hier darf das Verdichten nie aufhalten
      await $.session.usage().then(u => setzeMessung($, u)).catch(() => undefined)
      // Fuer die Zeile unter der Antwort: die Zahl von vorher gilt nicht mehr
      await update($, verdichtet, () => true)
      await update($, vorher, () => null)
    }
    return ergebnis
  })

  on('ui.scroll', async ($, e, next) => {
    if (e.component !== 'AbovePrompt' || e.origin.kind !== 'person' || !(await read($, auswahlOffen))) return next(e)
    const reihen = Math.ceil((await read($, szenen)).length / KARTEN_JE_REIHE)
    await update($, kartenStart, s => blaettere(s ?? 0, e.by, reihen))
    return next({ ...e, offset: 1 })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const istAn = await read($, an)
    const elemente = $.ui.resolve(e)
    const { Box, Text, Button } = elemente

    // Schiebeschalter aus zwei Zeichen: an steht der Knopf rechts auf dunklem Grund,
    // aus links auf grauem.
    // Kein `label`: die Desktop-App zeichnet sonst den Namen statt der Zeichen.
    const schalter = (
      <Button key="schalter" plain onPress={() => schalte($, !istAn)}>
        {istAn
          ? <Text backgroundColor="text" color="inverseText">{' ━●'}</Text>
          : <Text backgroundColor="subtle" color="inverseText">{'●━ '}</Text>}
      </Button>
    )

    const rahmen = RAND ? { borderStyle: 'round', borderColor: 'text', paddingX: 1 } : {}

    if (!istAn) {
      return <Box {...rahmen}>{schalter}</Box>
    }

    const m = await read($, messung)
    const nun = await read($, jetzt)
    const szene = szeneZu(await read($, szenen), await read($, clawd))
    // Bilder gibt es nur, wo die Oberflaeche Svg zeichnet (Desktop-App), nicht im Terminal.
    // Nach der Oberflaeche entscheiden, nicht danach, ob der Name Svg vorhanden ist: im
    // Terminal ist er es, die Grafik faellt dort aber still weg (gesehen am 14.10.2026).
    const Svg = e.surface !== 'terminal' && 'Svg' in elemente ? (elemente as { Svg: typeof Text }).Svg : undefined

    const det = await read($, ansicht)
    const ab = await read($, schwelle)
    // Jede Anzeige ist ein Knopf ohne Rahmen; ein Klick schaltet ihre Details um
    const anzeige = (key: string, st: Stueck[], welche: 'fuenf' | 'woche' | 'kontext') => (
      <Button key={key} plain onPress={() => umschalten($, welche)}>
        {st.map((x, i) => <Text key={`${key}${i}`} bold={x.fett} dimColor={x.blass}>{x.t}</Text>)}
      </Button>
    )
    const trenner = (i: number) => <Text key={`t${i}`} dimColor>{`${NBSP}${NBSP}·${NBSP}${NBSP}`}</Text>
    const zeile = m === null
      ? [<Text key="leer" dimColor>Usage: noch keine Messung</Text>]
      : [
          ...(m.limits.length === 0
            ? [<Text key="keine" dimColor>{`Limits:${NBSP}keine${NBSP}Angabe`}</Text>]
            : m.limits.flatMap((l, i) => {
                const welche = l.kind === 'seven_day' ? 'woche' : 'fuenf'
                const knopf = anzeige(`limit-${l.kind}`, limitStuecke(l, nun, det[welche]), welche)
                return i === 0 ? [knopf] : [trenner(i), knopf]
              })),
          trenner(9),
          Svg
            ? <Svg key="kreis" source={kreis(m.kontextProzent ?? 0)} alt="Kontext" width={14} height={14} />
            : <Text key="kreis" dimColor>Kontext</Text>,
          <Text key="luecke">{NBSP}</Text>,
          anzeige('kontext', kontextStuecke(m, det.kontext, ab), 'kontext'),
          // Puffer: die App misst Text schmaler, als sie ihn zeichnet. Ohne ihn schnitt der
          // Kasten am 14.10.2026 das Ende einer laengeren Zeile ab.
          <Text key="puffer">{NBSP.repeat(4)}</Text>,
        ]

    const offen = await read($, auswahlOffen)
    const laufendeAgenten = Object.values(await read($, agenten)).filter(t => nun - t < AGENT_STILL).length
    const laeuftJetzt = (await read($, arbeitet)) || laufendeAgenten > 0
    const kopf = (
      <Box alignItems="center" position="relative">
        {schalter}
        {/* Fest eine Zeile hoch: die Desktop-App bricht sonst um, statt abzuschneiden */}
        <Box marginLeft={1} flexShrink={1} minWidth={0} height={1} overflow="hidden" alignItems="center">{zeile}</Box>
        <Box flexGrow={1} minWidth={2} />
        {/* Waehrend die Auswahl offen ist, ruht Clawd: das spart eine grosse Grafik */}
        {Svg && szene && !offen
          ? <Box flexShrink={0} marginRight={3}>
              <Svg source={laeuftJetzt ? szene.svg : standbild(szene.svg)} alt={`Clawd: ${szene.titel}`}
                width={Math.round((szene.breite * CLAWD_HOEHE) / szene.hoehe)} height={CLAWD_HOEHE} />
            </Box>
          : null}
        <Box position="absolute" top={0} right={0}>
          <Button key="punkt" plain dimColor onPress={() => klappe($, !offen)}>•</Button>
        </Box>
      </Box>
    )
    // Spaltenrichtung, damit die Kopfzeile die ganze Breite nimmt und Clawd rechts am Rand
    // steht. In Zeilenrichtung war sie nur so breit wie ihr Inhalt (14.10.2026).
    if (!offen) return <Box {...rahmen} flexDirection="column">{kopf}</Box>

    // Die Auswahl, aufgeklappt unter der Zahlenzeile
    const gewaehlt = await read($, clawd)
    const laeuft = await read($, spielt)
    const favs = await read($, favoriten)
    // Favoriten zuerst in ihrer Reihenfolge, der Rest wie bisher (sort ist stabil)
    const rang = (key: string) => { const i = favs.indexOf(key); return i < 0 ? 1e9 : i }
    const sortiert = [...(await read($, szenen))].sort((a, b) => rang(a.key) - rang(b.key))
    const reihen = Math.ceil(sortiert.length / KARTEN_JE_REIHE)
    const start = Math.min(await read($, kartenStart), Math.max(0, reihen - 2))
    const alle = sortiert.slice(start * KARTEN_JE_REIHE)
    // Drei Karten je Reihe: die Breite der Zeile in Zeichen, abzueglich der Abstaende und
    // etwas Luft, weil die App Text schmaler misst, als sie ihn zeichnet
    const kartenBreite = Math.max(24, Math.floor((e.props.bodyColumns - KARTEN_JE_REIHE - 2) / KARTEN_JE_REIHE))
    return (
      <Box {...rahmen} flexDirection="column">
        <Box key="luft" height={1} />
        <Box key="kopf" flexDirection="column">{kopf}</Box>
        <Text>
          <Text bold>Welcher Clawd soll in der Zeile leben?</Text>
          {reihen > 2 ? <Text dimColor>{`   Reihe ${start + 1} von ${reihen}, weiter mit dem Mausrad`}</Text> : null}
        </Text>
        {alle.length === 0 ? <Text dimColor>Im Ordner szenen\ liegen keine Szenen.</Text> : null}
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {alle.map(sz => {
            const ganz = sz.key === laeuft
            const fav = favs.includes(sz.key)
            return (
              <Box key={`karte-${sz.key}`} flexDirection="row" width={kartenBreite} paddingX={1} gap={1} position="relative"
                borderStyle="round" borderColor={sz.key === gewaehlt ? 'text' : 'subtle'}>
                <Box position="absolute" top={0} right={0}>
                  <Button key={`stern-${sz.key}`} plain dimColor={!fav} onPress={() => stern($, sz.key)}>
                    {fav ? '★' : '☆'}
                  </Button>
                </Box>
                {Svg
                  ? <Box flexShrink={0} alignItems="center" justifyContent="center">
                      {ganz
                        ? <Svg source={sz.svg} alt={`${sz.titel}, ganzer Ablauf`}
                            width={Math.round((sz.breite * VORSCHAU_HOEHE) / sz.hoehe)} height={VORSCHAU_HOEHE} />
                        : <Svg source={sz.vorschau} alt={sz.titel}
                            width={Math.round((sz.vbreite * VORSCHAU_HOEHE) / sz.vhoehe)} height={VORSCHAU_HOEHE} />}
                    </Box>
                  : null}
                <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                <Text bold>{sz.titel}</Text>
                {/* Kurz nur, was Clawd tut, hoechstens zwei Zeilen. Beim Abspielen der ganze Text mit Handlung. */}
                {ganz
                  ? <Text dimColor wrap="wrap">{beschreibung(sz)}</Text>
                  : <Box height={2} overflow="hidden"><Text dimColor wrap="wrap">{kurzText(sz)}</Text></Box>}
                <Box flexDirection="row" gap={1}>
                  <Button key={`wahl-${sz.key}`} variant={sz.key === gewaehlt ? 'primary' : 'secondary'}
                    onPress={() => waehle($, sz.key)}>
                    {sz.key === gewaehlt ? 'Gewählt' : 'Auswählen'}
                  </Button>
                  {Svg
                    ? <Button key={`spiel-${sz.key}`} variant="secondary"
                        onPress={() => update($, spielt, () => (ganz ? '' : sz.key))}>
                        {ganz ? 'Stopp' : 'Abspielen'}
                      </Button>
                    : null}
                </Box>
                </Box>
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })
}

async function umschalten($: EngineInterface, welche: 'fuenf' | 'woche' | 'kontext') {
  const neu = !(await read($, ansicht))[welche]
  await update($, ansicht, a => ({ ...(a ?? { fuenf: false, woche: false, kontext: false }), [welche]: neu }))
  if (welche === 'kontext' && neu) await leseSchwelle($)
}

// Schwelle des Autocompact. Sie steht nur in der Aufteilung wie bei /context; 'summary'
// schaetzt lokal und schickt keine Anfrage an den Server.
async function leseSchwelle($: EngineInterface) {
  const b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  if (b !== undefined) await merkeSchwelle($, b)
}

// Uebernimmt eine Messung. Die Liste der Limits ist leer, solange die Sitzung noch keine
// frische Angabe vom Server hat, etwa direkt nach dem Start oder einem Neuladen. Eine
// leere Liste ersetzt deshalb nie bekannte Limits: es bleiben die zuletzt gemessenen, aus
// dieser Sitzung oder, in einer neuen, aus dem Speicher. Limits, deren Reset vorbei ist,
// fallen weg. Ohne das stand am 14.10.2026 nach einem Neuladen "Limits: keine Angabe".
async function setzeMessung($: EngineInterface, f: { rateLimits: SessionRateLimit[]; context: SessionContextUsage }) {
  const neu = alsMessung(f)
  await schaetzeKontext($, neu)
  if (neu.limits.length > 0) {
    await merkeLimits($, neu.limits)
  } else {
    const bisher = (await read($, messung))?.limits ?? []
    const gemerkt = bisher.length > 0 ? bisher : await gemerkteLimits($)
    const nun = await $.clock.now()
    neu.limits = gemerkt.filter(l => l.resetsAt === undefined || Date.parse(l.resetsAt) > nun)
  }
  await update($, messung, () => neu)
}

// Die zuletzt gemessenen Limits liegen in einer eigenen Datei neben dem Mod-Ordner, nicht
// nur im Speicher des Mods ($.store). Jede Sitzung der App ist ein eigener Prozess. Am
// 14.10.2026 stand im Speicher nach einem Klick auf den Schalter in einer anderen Sitzung
// nur noch Schalter und Szene, die Limits fehlten, und alte Sitzungen zeigten "Limits:
// keine Angabe". Die Datei liegt ausserhalb des Mod-Ordners, damit ein Schreiben dort kein
// Neuladen des Mods ausloest.
function nebenDatei($: EngineInterface, name: string): string {
  return `${$.plugin.root.replace(/[\\/]+[^\\/]+[\\/]*$/, '')}/${name}`
}
function limitsDatei($: EngineInterface): string {
  return nebenDatei($, 'usage-zeile-limits.json')
}
let zuletztGeschrieben = ''

async function merkeLimits($: EngineInterface, limits: Messung['limits']) {
  const text = JSON.stringify(limits)
  if (text === zuletztGeschrieben) return
  zuletztGeschrieben = text
  await $.store.set('limits', limits)
  try {
    await $.fs.write(limitsDatei($), text)
  } catch {
    // ohne Dateizugriff (Testbaukasten) bleibt der Speicher
  }
}

async function gemerkteLimits($: EngineInterface): Promise<Messung['limits']> {
  try {
    const aus = JSON.parse(String(await $.fs.read(limitsDatei($)))) as Messung['limits']
    if (Array.isArray(aus) && aus.length > 0) return aus
  } catch {
    // Datei fehlt oder kein Dateizugriff
  }
  return ((await $.store.get('limits')) as Messung['limits'] | undefined) ?? []
}

// Die Favoriten liegen aus demselben Grund wie die Limits in einer eigenen Datei neben dem
// Mod-Ordner. Vor jedem Umschalten wird sie neu gelesen, damit ein Stern aus einer anderen
// Sitzung nicht verloren geht.
async function gemerkteFavoriten($: EngineInterface): Promise<string[]> {
  try {
    const aus = JSON.parse(String(await $.fs.read(nebenDatei($, 'usage-zeile-favoriten.json'))))
    if (Array.isArray(aus)) return aus.filter((k): k is string => typeof k === 'string')
  } catch {
    // Datei fehlt oder kein Dateizugriff (Testbaukasten)
  }
  const gespeichert = await $.store.get('favoriten')
  return Array.isArray(gespeichert) ? gespeichert.filter((k): k is string => typeof k === 'string') : []
}

async function stern($: EngineInterface, key: string) {
  const bisher = await gemerkteFavoriten($)
  const neu = bisher.includes(key) ? bisher.filter(k => k !== key) : [key, ...bisher]
  await update($, favoriten, () => neu)
  await $.store.set('favoriten', neu)
  try {
    await $.fs.write(nebenDatei($, 'usage-zeile-favoriten.json'), JSON.stringify(neu))
  } catch {
    // ohne Dateizugriff (Testbaukasten) bleibt der Speicher
  }
}

async function schalte($: EngineInterface, wert: boolean) {
  await update($, an, () => wert)
  await $.store.set('an', wert)
}

async function waehle($: EngineInterface, key: string) {
  await update($, clawd, () => key)
  await $.store.set('clawd', key)
  await klappe($, false)
}

async function klappe($: EngineInterface, auf: boolean) {
  await update($, kartenStart, () => 0)
  if (auf) {
    await ladeSzenen($)      // neue Dateien im Ordner erscheinen so sofort
    const favs = await gemerkteFavoriten($)
    await update($, favoriten, () => favs)
  }
  await update($, spielt, () => '')
  await update($, auswahlOffen, () => auf)
  // Das Fenster der App gleich auf die Kopfzeile stellen, die leere Zeile darueber verschwindet
  if (auf) $.clock.after(150, () => void $.ui.scroll({ to: { key: 'kopf' }, block: 'start' }).catch(() => undefined))
}

// Liest alle Szenen aus dem Ordner szenen\. Eine Datei, die sich nicht lesen laesst, wird
// uebergangen, statt die Auswahl leer zu lassen.
async function ladeSzenen($: EngineInterface) {
  const gelesen: Szene[] = []
  for (const [name, lies] of await dateien($)) {
    if (!name.endsWith('.json')) continue
    try {
      const sz = JSON.parse(await lies()) as Szene
      if (sz.key && sz.svg && sz.vorschau) gelesen.push(sz)
    } catch {
      // kaputte Datei: weglassen
    }
  }
  // Erst die eingebauten Szenen in ihrer Reihenfolge, dann neue nach Titel
  gelesen.sort((a, b) => (a.nr ?? 1e9) - (b.nr ?? 1e9) || a.titel.localeCompare(b.titel, 'de'))
  await update($, szenen, () => gelesen)
}

// Die Dateien des Ordners szenen\ als (Name, Lesen). Laesst sich der Ordner nicht lesen,
// kommen sie aus dem Speicher unter 'szenen-test' als { Dateiname: Inhalt }. Das braucht
// der Testbaukasten (claude plugin test), der keinen Dateizugriff hat. In der App ist
// dieser Speicher leer. Pruefen und Sortieren laufen in beiden Faellen gleich.
async function dateien($: EngineInterface): Promise<[string, () => Promise<string>][]> {
  const ordner = `${$.plugin.root}/szenen`
  try {
    const eintraege = await $.fs.list(ordner)
    return eintraege
      .filter(e => e.kind === 'file')
      .map(e => [e.name, async () => String(await $.fs.read(`${ordner}/${e.name}`))])
  } catch {
    const ersatz = (await $.store.get('szenen-test')) as Record<string, string> | undefined
    return Object.entries(ersatz ?? {}).map(([name, text]) => [name, async () => text])
  }
}

async function stelleEin($: EngineInterface) {
  await ladeSzenen($)
  // Schalter und Wahl gelten ueber Sitzungen hinweg
  const gemerktAn = await $.store.get('an')
  if (typeof gemerktAn === 'boolean') await update($, an, () => gemerktAn)
  const gemerktClawd = await $.store.get('clawd')
  if (typeof gemerktClawd === 'string') await update($, clawd, () => gemerktClawd)

  const u = await $.session.usage()
  await setzeMessung($, u)
  const tick = async () => {
    const nun = await $.clock.now()
    await update($, jetzt, () => nun)
  }
  await tick()
  // Die Restzeit soll weiterlaufen, auch wenn keine neue Messung kommt.
  $.clock.every(60000, () => void tick())
}
