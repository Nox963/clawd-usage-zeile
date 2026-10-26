import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Block, Punkt, Punkte } from '../types'

// Panel mit den offenen Punkten der Auftragsdateien, die zur Sitzung gehoeren (16.10.2026, Wunsch
// des Nutzers). Geoeffnet wird es ueber den Knopf ≡ rechts in der Usage-Zeile. Ein Klick auf
// einen Punkt schreibt einen kurzen Auftrag ins Eingabefeld, abgeschickt wird er mit Enter.
//
// Seit 18.10.2026 ein Block je Auftragsdatei, einklappbar (Wunsch des Nutzers: "pro Ebene die
// offenen Punkte", ein Teilprojekt mit eigenem Block). Bis dahin las das Panel nur die
// naechste AUFTRAG.md ueber dem Arbeitsordner und fand deshalb keine der Dateien, die in
// Unterordnern des Projekts liegen (Projekt\teil\AUFTRAG.md, eval\AUFTRAG_*.md).
// Gesammelt werden:
//   1. jede AUFTRAG.md im Arbeitsordner und darueber, wie die App eine CLAUDE.md sucht
//   2. AUFTRAG.md und AUFTRAG_*.md in den Unterordnern des Arbeitsordners, eine Ebene tief
//   3. dieselben Dateien in Ordnern, die usage-zeile-ordner.json fuer diesen Arbeitsordner
//      nennt, etwa der Ordner einer Kundin auf dem Desktop. Die Datei liegt neben dem Mod-Ordner
//      und wird von Hand oder von Claude gepflegt, Aufbau siehe ORDNER_DATEI.
// Bloecke ohne offenen Punkt erscheinen nicht, ihre Zahl steht am Ende. Der zuletzt geaenderte
// Block steht oben und ist anfangs aufgeklappt, die anderen zu. Ein Klick auf die Kopfzeile
// klappt um, der Zustand bleibt ueber Sitzungen im Speicher des Mods.
//
// Gelesen wird bei jedem Zeichnen des Panels, also beim Oeffnen, beim Umklappen und mit
// "Neu lesen". Ein Hook auf ui.open taugt dafuer nicht: Der eigene $.ui.open des Mods laeuft nicht
// durch seine eigenen Hooks (im Test gesehen am 16.10.2026).

export const PANEL = 'offene-punkte'
// Zaehlt "Neu lesen" hoch. Das Panel liest ihn, ein neuer Wert zeichnet es neu
const gelesen = atom({ plugin: 'usage-zeile', key: 'punkteGelesen' } as const, 0)
// Je Auftragsdatei (voller Pfad) aufgeklappt (true) oder zu (false). Fehlt sie, gilt die Vorgabe
const aufgeklappt = atom({ plugin: 'usage-zeile', key: 'punkteAuf' } as const, {})

// Pakete, deren Stand so beginnt, sind abgeschlossen und erscheinen nicht
const FERTIG = /^(erledigt|verworfen|abgeschlossen|fertig)\b/i
const AUFTRAGSDATEI = /^AUFTRAG(_.+)?\.md$/i
// {"<Arbeitsordner>": {"dazu": ["<Ordner>", ...], "ohne": ["<Unterordner>", ...]}}
// "dazu": weitere Ordner mit Auftragsdateien. "ohne": Unterordner, die nicht durchsucht werden,
// etwa ein eingefrorenes Uebergabepaket mit alten Auftraegen.
const ORDNER_DATEI = 'usage-zeile-ordner.json'

// Abschnitte "## Name" der Datei als { Name: Text }
function abschnitte(md: string): Record<string, string> {
  const aus: Record<string, string> = {}
  let name = ''
  for (const zeile of md.split(/\r?\n/)) {
    const k = /^## +(.+?)\s*$/.exec(zeile)
    if (k) { name = k[1] ?? ''; aus[name] = ''; continue }
    if (name !== '') aus[name] += `${zeile}\n`
  }
  return aus
}

function ohneMarkdown(s: string): string {
  return s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim()
}

function kuerze(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`
}

// Text des ersten Abschnitts, dessen Ueberschrift so beginnt ("Offen" findet auch
// "Offen, braucht eine Entscheidung" aus der Vorlage)
function abschnitt(teile: Record<string, string>, anfang: string): string {
  const name = Object.keys(teile).find(n => n.toLowerCase().startsWith(anfang.toLowerCase()))
  return name === undefined ? '' : (teile[name] ?? '')
}

// Liest aus dem Text einer Auftragsdatei die nicht abgeschlossenen Pakete und die Punkte unter
// "## Offen …". Erwartet den Aufbau der Vorlage ~\.claude\vorlagen\AUFTRAG_vorlage.md.
// Ein Punkt ist ein Listeneintrag am Zeilenanfang, mit "- ", "* " oder nummeriert ("1. ").
// Eingerueckte Unterpunkte gehoeren zu ihm. `datei` ist der Name, unter dem der Auftrag im
// Eingabefeld die Datei nennt.
export function offenePunkte(md: string, ordner: string, datei = 'AUFTRAG.md'): Punkte {
  const titel = ohneMarkdown(/^# +(.+)$/m.exec(md)?.[1] ?? datei)
  const teile = abschnitte(md)
  const liste: Punkt[] = []

  // Pakete: "### P-1 · Titel", darin "- **Stand:** …"
  const pakete = abschnitt(teile, 'Pakete')
  for (const block of pakete.split(/^### +/m).slice(1)) {
    const kopf = block.split(/\r?\n/)[0] ?? ''
    const m = /^(\S+)\s*[·:–-]\s*(.+)$/.exec(kopf.trim())
    const nr = m ? (m[1] ?? '') : ''
    const name = ohneMarkdown(m ? (m[2] ?? '') : kopf)
    const stand = ohneMarkdown(/^- \*\*Stand:\*\*\s*([\s\S]*?)(?=^- \*\*|^###|$(?![\s\S]))/m.exec(block)?.[1] ?? '')
    if (FERTIG.test(stand)) continue
    liste.push({
      art: 'paket',
      titel: nr === '' ? name : `${nr} · ${name}`,
      zusatz: kuerze(stand, 140),
      prompt: `Nimm dir aus der ${datei} das Paket ${nr === '' ? '' : `${nr} `}„${name}“ vor und arbeite es bis zum Erfolgskriterium ab.`,
    })
  }

  // Offen: Listeneintraege, Titel ist der fette Anfang, sonst der Anfang des Satzes
  const offen = abschnitt(teile, 'Offen')
  // Auch "* " zaehlt als Punkt: eval\AUFTRAG_api_messung.md schreibt seine Listen so (18.10.2026)
  for (const punkt of offen.split(/^(?:[-*] |\d+\. )/m).slice(1)) {
    const text = ohneMarkdown(punkt)
    if (text === '') continue
    const fett = /^\*\*(.+?)\*\*/.exec(punkt.trim())?.[1]
    const name = fett !== undefined ? ohneMarkdown(fett).replace(/[:.,]$/, '') : kuerze(text, 80)
    const rest = fett !== undefined ? ohneMarkdown(punkt.trim().slice(fett.length + 4)) : ''
    liste.push({
      art: 'offen',
      titel: name,
      zusatz: kuerze(rest.replace(/^[:.]\s*/, ''), 140),
      prompt: `Zum offenen Punkt aus der ${datei} „${name}“: Was steht an, und was brauchst du von mir?`,
    })
  }

  return { titel, ordner, liste }
}

// Kurztitel fuer die Kopfzeile: der Teil des Titels vor dem ersten Doppelpunkt oder Gedankenstrich,
// etwa "Skill /beispiel" aus "Skill /beispiel: vollständige Prüfung …". Der Rest steht aufgeklappt
// darunter. Ohne Trenner bleibt der ganze Titel, die Kopfzeile kuerzt ihn dann mit "…".
export function kurztitel(titel: string): { kurz: string; rest: string } {
  const m = /^(.{2,}?)\s*(?::|\s[–—-])\s+(.+)$/.exec(titel)
  if (m === null) return { kurz: titel, rest: '' }
  const rest = m[2] ?? ''
  return { kurz: m[1] ?? titel, rest: rest.charAt(0).toUpperCase() + rest.slice(1) }
}

// Gefundene Dateien zu Bloecken: ohne doppelte Pfade, nur mit offenen Punkten, der zuletzt
// geaenderte oben. Rein, damit ein Test es ohne Dateizugriff pruefen kann.
export function ordneBloecke(dateien: readonly { pfad: string; name: string; ordner: string; content: string; mtimeMs: number }[]):
  { bloecke: Block[]; ohne: number } {
  const gesehen = new Set<string>()
  const alle: Block[] = []
  for (const d of dateien) {
    const schluessel = d.pfad.replace(/\//g, '\\').toLowerCase()
    if (gesehen.has(schluessel)) continue
    gesehen.add(schluessel)
    alle.push({ ...offenePunkte(d.content, d.ordner, d.name), datei: d.pfad, mtimeMs: d.mtimeMs })
  }
  const bloecke = alle.filter(b => b.liste.length > 0).sort((a, b) => b.mtimeMs - a.mtimeMs)
  return { bloecke, ohne: alle.length - bloecke.length }
}

export const punktePanel: Register = on => {
  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    await read($, gelesen)
    const auf: Record<string, boolean> = { ...(((await $.store.get('punkteAuf').catch(() => undefined)) as Record<string, boolean> | undefined) ?? {}),
      ...(await read($, aufgeklappt)) }
    const { bloecke, ohne } = ordneBloecke(await sammle($))
    const neu = <Button key="neu" variant="secondary" onPress={() => update($, gelesen, n => n + 1)}>Neu lesen</Button>

    if (bloecke.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>{ohne === 0
            ? 'Keine AUFTRAG.md im Arbeitsordner dieser Sitzung, darüber oder eine Ebene darunter.'
            : `Nichts offen in ${ohne} ${ohne === 1 ? 'Auftragsdatei' : 'Auftragsdateien'}.`}</Text>
          {neu}
        </Box>
      )
    }

    const umklappen = async (datei: string, jetzt: boolean) => {
      const neuStand = { ...auf, [datei]: !jetzt }
      await update($, aufgeklappt, () => neuStand)
      await $.store.set('punkteAuf', neuStand).catch(() => undefined)
    }

    const gruppe = (b: Block, nr: number, art: Punkt['art'], ueberschrift: string) => {
      const eintraege = b.liste.filter(x => x.art === art)
      if (eintraege.length === 0) return null
      return (
        <Box key={`b${nr}-gruppe-${art}`} flexDirection="column">
          <Text dimColor>{ueberschrift}</Text>
          {eintraege.map((x, i) => (
            <Button key={`b${nr}-${art}-${i}`} plain onPress={() => fuelle($, x.prompt)}>
              <Text>{x.titel}</Text>
              {x.zusatz === '' ? '' : <Text dimColor>{` · ${x.zusatz}`}</Text>}
            </Button>
          ))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {/* Bis 18.10.2026 stand hier ein Hinweis zur Bedienung, auf Wunsch des Nutzers entfernt */}
        {bloecke.map((b, nr) => {
          const offen = auf[b.datei] ?? nr === 0
          return (
            <Box key={`b${nr}`} flexDirection="column" gap={1}>
              {/* Der Titel steht ausserhalb der Knoepfe. Die Desktop-App zeichnet Text in einem Knopf
                  einheitlich, ohne Farbe und Fett, und kuerzt ihn auf eine Zeile (Screenshot des
                  Nutzers, 18.10.2026). Umklappen geht deshalb ueber das Dreieck und die Zahl. Fett
                  mit weight, `bold` gilt nur als halbfett. Farbe `claude` aus dem Farbschema, das
                  Orange folgt dem hellen und dunklen Modus (Wunsch des Nutzers, 18.10.2026).
                  In der Kopfzeile steht nur der Kurztitel auf einer Zeile, der volle Titel erst
                  aufgeklappt darunter. Ganz umbrochen war das schmale Panel unuebersichtlich
                  (Wunsch des Nutzers, 18.10.2026) */}
              <Box key={`b${nr}-kopfzeile`} flexDirection="row" alignItems="center" gap={1}>
                <Button key={`b${nr}-kopf`} plain onPress={() => umklappen(b.datei, offen)}>{offen ? '▾' : '▸'}</Button>
                <Box flexShrink={1} flexGrow={1} minWidth={0} height={1} overflow="hidden">
                  <Text weight="bold" color="claude" wrap="truncate-end">{kurztitel(b.titel).kurz}</Text>
                </Box>
                <Button key={`b${nr}-zahl`} plain dimColor onPress={() => umklappen(b.datei, offen)}>{`${b.liste.length} offen`}</Button>
              </Box>
              {offen && kurztitel(b.titel).rest !== '' ? <Text>{kurztitel(b.titel).rest}</Text> : null}
              {offen ? <Text dimColor>{b.datei}</Text> : null}
              {offen ? gruppe(b, nr, 'paket', 'Pakete') : null}
              {offen ? gruppe(b, nr, 'offen', 'Offen') : null}
            </Box>
          )
        })}
        {ohne === 0 ? null : <Text dimColor>{`${ohne} weitere ${ohne === 1 ? 'Auftragsdatei' : 'Auftragsdateien'} ohne offene Punkte.`}</Text>}
        {neu}
      </Box>
    )
  })
}

function vereine(pfad: string): string {
  return pfad.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

// Alle Auftragsdateien der Sitzung, siehe Kopf. Im Testbaukasten (claude plugin test) gibt es
// keinen Dateizugriff. Dort kommen die Dateien aus dem Speicher: 'auftraege-test' als Liste
// { pfad, name, ordner, content, mtimeMs }, oder 'auftrag-test' als einzelne { dir, content }.
// In der App ist dieser Speicher leer.
async function sammle($: EngineInterface) {
  const aus: { pfad: string; name: string; ordner: string; content: string; mtimeMs: number }[] = []
  try {
    const wurzel = await $.session.root()
    // 1. Arbeitsordner und darueber
    for (const a of await $.fs.ancestors({ names: ['AUFTRAG.md'] })) {
      const pfad = `${a.dir}\\${a.name}`
      const mtimeMs = (await $.fs.stat(pfad).catch(() => undefined))?.mtimeMs ?? 0
      aus.push({ pfad, name: vereine(a.dir) === vereine(wurzel) ? a.name : pfad, ordner: a.dir, content: a.content, mtimeMs })
    }
    // 3. weitere Ordner aus usage-zeile-ordner.json, dazu die Unterordner, die nicht zaehlen
    let dazu: string[] = []
    let ohne: string[] = []
    try {
      const plan = JSON.parse(String(await $.fs.read(nebenDatei($, ORDNER_DATEI)))) as Record<string, { dazu?: string[]; ohne?: string[] }>
      const eintrag = Object.entries(plan).find(([k]) => vereine(k) === vereine(wurzel))?.[1]
      dazu = eintrag?.dazu ?? []
      ohne = (eintrag?.ohne ?? []).map(x => x.toLowerCase())
    } catch {
      // keine Datei: nur Arbeitsordner und Unterordner
    }
    // 2. Unterordner, eine Ebene tief
    const unter = (await $.fs.list(wurzel)).filter(x => x.kind === 'dir' && !/^[._]/.test(x.name)
      && x.name !== 'node_modules' && !ohne.includes(x.name.toLowerCase()))
    const ordner = [...unter.map(x => ({ dir: `${wurzel}\\${x.name}`, kurz: x.name })), ...dazu.map(d => ({ dir: d, kurz: '' }))]
    // Auftragsdateien direkt im Arbeitsordner, die nicht AUFTRAG.md heissen
    ordner.unshift({ dir: wurzel, kurz: '.' })
    for (const o of ordner) {
      const eintraege = await $.fs.list(o.dir).catch(() => [])
      for (const d of eintraege) {
        if (d.kind !== 'file' || !AUFTRAGSDATEI.test(d.name)) continue
        if (o.kurz === '.' && d.name.toLowerCase() === 'auftrag.md') continue   // schon unter 1.
        const pfad = `${o.dir}\\${d.name}`
        const content = await $.fs.read(pfad).catch(() => undefined)
        if (typeof content !== 'string') continue
        const name = o.kurz === '' ? pfad : o.kurz === '.' ? d.name : `${o.kurz}\\${d.name}`
        aus.push({ pfad, name, ordner: o.dir, content, mtimeMs: d.mtimeMs })
      }
    }
  } catch {
    const liste = (await $.store.get('auftraege-test').catch(() => undefined)) as typeof aus | undefined
    if (liste !== undefined) return liste
    const ersatz = (await $.store.get('auftrag-test').catch(() => undefined)) as { dir: string; content: string } | undefined
    if (ersatz !== undefined) aus.push({ pfad: `${ersatz.dir}\\AUFTRAG.md`, name: 'AUFTRAG.md', ordner: ersatz.dir, content: ersatz.content, mtimeMs: 0 })
  }
  return aus
}

// Dateien des Mods neben dem Mod-Ordner, wie die Limits und Favoriten in register.tsx: Ein Schreiben
// dort loest kein Neuladen des Mods aus.
function nebenDatei($: EngineInterface, name: string): string {
  return `${$.plugin.root.replace(/[\\/]+[^\\/]+[\\/]*$/, '')}/${name}`
}

// Auftrag ins Eingabefeld. Steht dort schon etwas, kommt er in einer neuen Zeile dahinter,
// damit nichts Getipptes verloren geht.
async function fuelle($: EngineInterface, text: string) {
  const { text: entwurf } = await $.prompt.read()
  await $.prompt.fill(entwurf.trim() === '' ? { text, mode: 'replace' } : { text: `\n${text}`, mode: 'append' })
}
