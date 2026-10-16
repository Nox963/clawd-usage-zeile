import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// Die Zeile unter jeder fertigen Antwort: "Claude cooked for 3m 4s · +8,4k". Die Zahl ist der
// Beitrag der Antwort zum Kontextfenster: Kontext nach dieser Antwort minus Kontext nach der
// vorigen. Darin steckt alles, was die Antwort in den Kontext gebracht hat, also die Nachricht
// des Nutzers, eingespielte Hook-Texte, Werkzeugergebnisse und Claudes Text. Ein- und
// Ausgabetokens zeigt sie bewusst nicht (Wunsch des Nutzers, 15.10.2026).
//
// Das Terminal setzt diese Zeile selbst ("Baked for 3s"). Die Desktop-App zeichnet ihren
// eigenen Abschluss und gibt ihn fuer Mods nicht frei. Die erste Fassung gab die Zeile darum
// als Text aus turn.complete aus. Die Desktop-App zeigte ihn aber nur eingeklappt als
// "Claude Code notice" (15.10.2026). Seither haengt der Mod die Zeile an den letzten
// Textblock der Antwort: Die App zeichnet den Block wie immer, darunter steht die Zeile.

// Die Verben, aus denen der Mod je Antwort zufaellig eines waehlt. Die ersten acht sind die
// der Schlusszeile des Terminals, ausgelesen aus Claude Code 2.1.295 am 15.10.2026 (das
// Terminal waehlt eines fest nach der Kennung der Antwort). Die uebrigen sind die
// Vergangenheitsformen aus der Liste, die das Terminal waehrend der Arbeit zeigt
// ("Simmering…"), vom Nutzer in drei Gruppen gewaehlt am 15.10.2026. Die vierte
// vorgeschlagene Gruppe (Bewegung und Unsinn: moseyed, schlepped, moonwalked …) wollte er nicht.
// Noch am 15.10.2026 hat der Nutzer die 42 auf 15 gekuerzt und "clauded" dazugenommen.
// Gestrichen: churned, cogitated, crunched, fermented, percolated, caramelized, garnished,
// zested, concocted, mulled, ruminated, contemplated, deliberated, pontificated, mused,
// noodled, deciphered und die ganze Gruppe Bauen und Basteln (crafted, forged, tinkered,
// orchestrated, choreographed, synthesized, crystallized, computed, wrangled, transmogrified).
export const VERBEN = [
  // Schlusszeile des Terminals
  'baked', 'brewed', 'cooked', 'sautéed', 'worked',
  // Kueche
  'simmered', 'marinated', 'stewed', 'whisked', 'kneaded', 'flambéed', 'julienned', 'seasoned',
  // Nachdenken
  'pondered', 'philosophized',
  // eigenes
  'clauded',
]

// Kontext nach der vorigen Antwort in Tokens, null solange unbekannt
const vorher = atom({ plugin: 'usage-zeile', key: 'vorher' } as const, null)
// true, sobald waehrend der laufenden Antwort verdichtet wurde. Nach dem Verdichten setzt
// beide der Hook auf session.compact in register.tsx: ein Mod meldet jedes Ereignis ohne
// Bedingung nur einmal an, und $ darf nicht ueber einen Import in eine andere Datei.
const verdichtet = atom({ plugin: 'usage-zeile', key: 'verdichtet' } as const, false)
// true, solange Claude an einer Antwort arbeitet. Der Clawd in der Usage-Zeile (register.tsx)
// bewegt sich nur dann und steht sonst still (Wunsch des Nutzers, 15.10.2026). Hier gesetzt,
// weil turn.start und turn.complete nur einmal je Mod angemeldet werden duerfen.
const arbeitet = atom({ plugin: 'usage-zeile', key: 'arbeitet' } as const, false)
// Laufende Subagenten, auch die im Hintergrund, als { Kennung: Zeit ihrer letzten Anfrage }.
// Sie arbeiten oft weiter, wenn die Antwort der Sitzung schon fertig ist ("1 running task"),
// und sollen den Clawd ebenso bewegen (Wunsch des Nutzers, 15.10.2026). Eingetragen bei jeder
// Modellanfrage eines Subagenten (turn.step), gestrichen, wenn er fertig ist (turn.complete).
const agenten = atom({ plugin: 'usage-zeile', key: 'agenten' } as const, {})

// Die Zeilen je Antwort, als { Schluss der Antwort: Zeile }. null, bis die Datei gelesen ist.
const zeilen = atom({ plugin: 'usage-zeile', key: 'zeilen' } as const, null)

// Die Zeilen ueberstehen einen Neustart der App in einer Datei neben dem Mod-Ordner, wie die
// Limits. Der Speicher des Mods ($.store) taugt dafuer nicht, ihn schreibt jede Sitzung neu.
// Ausserhalb des Mod-Ordners, damit ein Schreiben kein Neuladen des Mods ausloest.
const HOECHSTENS = 500          // so viele Zeilen behaelt die Datei, die aeltesten fallen weg

// Den Schlusstext der Antwort meldet die Sitzung noch nicht als Kontext: ihre Zahl ist die
// Eingabe der letzten Anfrage, ohne deren Ausgabe. Er wird darum geschaetzt, gut 3,5 Zeichen
// je Token fuer deutschen Text.
const ZEICHEN_JE_TOKEN = 3.5

// Aussehen der Zeile unter der Antwort
const ABSTAND = 1               // Leerzeilen zwischen Antwort und Zeile
const FARBE = 'claude'          // Farbe aus dem Farbschema der App: das Claude-Orange

// Woran der Mod den letzten Textblock einer Antwort erkennt: an den letzten 120 Zeichen,
// Leerraum zusammengefasst. Die App zeichnet den Block aus demselben Text, der Schluss stimmt.
const SCHLUSS = 120
export function schluessel(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(-SCHLUSS)
}

// 12s, 3m 4s, 1h 2m, wie das Terminal
export function dauer(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// +850, +8,4k, +12k, +1,2M; eine Abnahme mit echtem Minus
export function beitrag(tokens: number): string {
  const v = tokens < 0 ? '−' : '+'
  const t = Math.abs(tokens)
  const komma = (x: number) => String(x).replace('.', ',')
  if (t >= 1_000_000) return `${v}${komma(Math.round(t / 100_000) / 10)}M`
  if (t >= 10_000) return `${v}${Math.round(t / 1000)}k`
  if (t >= 1000) return `${v}${komma(Math.round(t / 100) / 10)}k`
  return `${v}${t}`
}

// Kontext jetzt. Nach /compact meldet die Sitzung bis zur naechsten Antwort keine Zahl, dann
// die lokale Schaetzung wie /context (ohne Anfrage an den Server).
async function kontextJetzt($: EngineInterface): Promise<number | undefined> {
  try {
    const u = await $.session.usage()
    if (u.context.tokens !== undefined) return u.context.tokens
    return (await $.session.usage({ breakdown: 'summary' })).context.breakdown?.totalTokens
  } catch {
    return undefined
  }
}

function zeilenDatei($: EngineInterface): string {
  return `${$.plugin.root.replace(/[\\/]+[^\\/]+[\\/]*$/, '')}/usage-zeile-antwortzeilen.json`
}

async function leseDatei($: EngineInterface): Promise<Record<string, string>> {
  try {
    const aus = JSON.parse(String(await $.fs.read(zeilenDatei($)))) as Record<string, string>
    if (aus !== null && typeof aus === 'object') return aus
  } catch {
    // Datei fehlt oder kein Dateizugriff (Testbaukasten)
  }
  return {}
}

// Liest die Datei einmal je Sitzung in den Zustand, damit auch Antworten von vor einem
// Neustart ihre Zeile zeigen. Ein Zeichen-Hook darf nicht schreiben, darum geschieht das
// hier und nicht beim Zeichnen.
async function ladeZeilen($: EngineInterface) {
  if ((await read($, zeilen)) !== null) return
  const gelesen = await leseDatei($)
  await update($, zeilen, z => ({ ...gelesen, ...(z ?? {}) }))
}

// Neue Zeile in Zustand und Datei. Die Datei wird vorher neu gelesen, denn andere Sitzungen
// schreiben ihre Zeilen in dieselbe Datei.
async function merkeZeile($: EngineInterface, schluss: string, zeile: string) {
  await update($, zeilen, z => ({ ...(z ?? {}), [schluss]: zeile }))
  const alle = { ...(await leseDatei($)), [schluss]: zeile }
  const behalten = Object.entries(alle).slice(-HOECHSTENS)
  try {
    await $.fs.write(zeilenDatei($), JSON.stringify(Object.fromEntries(behalten)))
  } catch {
    // ohne Dateizugriff bleibt die Zeile bis zum Neustart im Zustand
  }
}

export const antwortzeile: Register = on => {
  on('turn.start', async ($, e, next) => {
    const ergebnis = await next(e)
    await update($, arbeitet, () => true)
    await update($, verdichtet, () => false)
    if ((await read($, vorher)) === null) {
      const k = await kontextJetzt($)
      if (k !== undefined) await update($, vorher, () => k)
    }
    await ladeZeilen($)
    return ergebnis
  })

  // Beobachtet nur: die Anfrage selbst geht unveraendert weiter
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    if (id !== undefined) {
      const jetzt = await $.clock.now()
      await update($, agenten, a => ({ ...(a ?? {}), [id]: jetzt }))
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ergebnis = await next(e)
    const fertig = e.agentId
    if (fertig !== undefined) {
      await update($, agenten, a => Object.fromEntries(Object.entries(a ?? {}).filter(([k]) => k !== fertig)))
      return ergebnis                                     // Subagenten: ihr Kontext ist nicht der der Sitzung
    }
    await update($, arbeitet, () => false)

    const gemessen = await kontextJetzt($)
    const nachher = gemessen === undefined ? undefined : gemessen + Math.round(e.answer.length / ZEICHEN_JE_TOKEN)
    const alt = await read($, vorher)
    const warVerdichtet = await read($, verdichtet)
    await update($, vorher, () => nachher ?? null)
    await update($, verdichtet, () => false)

    // Nur unter einer fertigen Antwort mit Text, nicht nach Abbruch oder Fehler
    if (e.reason !== 'answer' || e.answer.trim() === '') return ergebnis

    const verb = VERBEN[Math.floor(Math.random() * VERBEN.length)] ?? 'worked'
    let zeile = `Claude ${verb} for ${dauer(e.durationMs)}`
    if (warVerdichtet) zeile += ' · verdichtet'
    else if (nachher !== undefined && alt !== null) zeile += ` · ${beitrag(nachher - alt)}`
    await merkeZeile($, schluessel(e.answer), zeile)
    return ergebnis
  })

  // Der letzte Textblock einer Antwort: die Zeichnung der App bleibt, darunter die Zeile.
  // Im Terminal steht die eigene Schlusszeile des Terminals schon da.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const bild = await next(e)
    if (e.surface === 'terminal' || e.props.isSummary) return bild
    const zeile = (await read($, zeilen))?.[schluessel(e.props.text)]
    if (zeile === undefined) return bild
    // Eine Leerzeile Abstand und das Orange aus dem Farbschema der App, das dem hellen und
    // dunklen Modus folgt (Wunsch des Nutzers, 15.10.2026). Zuerst stand sie ohne Abstand
    // und blass. Feiner als eine Zeile laesst sich der Abstand nicht setzen.
    // Das Verb steht kursiv (Wunsch des Nutzers, 15.10.2026). Die Datei haelt die Zeile als
    // einfachen Text, darum wird sie hier am Verb geteilt.
    const teile = /^(Claude )(\S+)( .*)$/.exec(zeile)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {bild}
        <Box marginTop={ABSTAND}>
          {teile
            ? <Text color={FARBE}>{teile[1]}<Text color={FARBE} italic>{teile[2]}</Text>{teile[3]}</Text>
            : <Text color={FARBE}>{zeile}</Text>}
        </Box>
      </Box>
    )
  })
}
