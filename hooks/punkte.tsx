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
//      nennt, etwa ein Ordner an anderer Stelle auf dem Rechner. Die Datei liegt neben dem Mod-Ordner
//      und wird von Hand oder von Claude gepflegt, Aufbau siehe ORDNER_DATEI.
// Bloecke ohne offenen Punkt erscheinen nicht, ihre Zahl steht am Ende. Der zuletzt geaenderte
// Block steht oben und ist anfangs aufgeklappt, die anderen zu. Ein Klick auf die Kopfzeile
// klappt um, der Zustand bleibt ueber Sitzungen im Speicher des Mods.
//
// Gelesen wird bei jedem Zeichnen des Panels, also beim Oeffnen, beim Umklappen und mit
// "Neu lesen". Ein Hook auf ui.open taugt dafuer nicht: Der eigene $.ui.open des Mods laeuft nicht
// durch seine eigenen Hooks (im Test gesehen am 16.10.2026).

export const PANEL = 'offene-punkte'
// Fuellt den Knopf ohne sichtbaren Text ueber der Kopfzeile: Ziffernbreites Leerzeichen (U+2007).
// Bis 29.10.2026 war es ein geschuetztes Leerzeichen. Das ist in der Schrift der App schmaler als
// eine Zeichenzelle, der graue Balken des Knopfs endete deshalb mitten im Titel (Screenshot des
// Nutzers). Eine Ziffer ist in der App aber etwas breiter als eine Zelle: Mit einer je Zelle lief
// der Text ueber den Kasten hinaus, und die App setzte ihr "…" unter das Wort "offen" (Screenshot
// des Nutzers, 29.10.2026). Seither fuellen sie nur sieben Zehntel des Kastens. Der Balken endet
// dadurch etwas vor der Zahl, aber ohne "…"
const FUELLER_ANTEIL = 0.7
const FUELLER = ' '
// Zaehlt "Neu lesen" hoch. Das Panel liest ihn, ein neuer Wert zeichnet es neu
const gelesen = atom({ plugin: 'usage-zeile', key: 'punkteGelesen' } as const, 0)
// Je Auftragsdatei (voller Pfad) aufgeklappt (true) oder zu (false). Fehlt sie, gilt die Vorgabe
const aufgeklappt = atom({ plugin: 'usage-zeile', key: 'punkteAuf' } as const, {})
// Die Auftragsdatei, deren Pfad als Pop-up unter ihrer Kopfzeile steht. Leer: keiner. Nur fuer
// diese Sitzung, ein Klick auf ⓘ zeigt oder verbirgt ihn
const pfadZeigen = atom({ plugin: 'usage-zeile', key: 'punktePfad' } as const, '')

// Pakete, deren Stand so beginnt, sind abgeschlossen oder zurueckgestellt und erscheinen nicht
const FERTIG = /^(erledigt|verworfen|abgeschlossen|fertig|zurückgestellt)\b/i
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

// "Wartet auf" in der Tabelle "Jetzt offen", wenn nichts aussteht
const WARTET_NICHT = /^(nichts\b|[-–—]?$)/i
// Ein Paket "braucht dich", wenn in "Wer ist dran" oder "Wartet auf" der Nutzer steht oder es auf
// einen Entscheid wartet. Entscheiden tut in den Auftragsdateien der Nutzer.
const BEIM_NUTZER = /\b(nutzer|nutzers|entscheid\w*)\b/i

// Die Tabelle "Jetzt offen" (seit 29.10.2026 oben in jeder Auftragsdatei):
// je Paketnummer wer dran ist, worauf es wartet und die Zeile (0 = oben = dringlichstes). Eine Zeile
// kann mehrere Pakete nennen ("4, 6 · …", "12 und 13 · …"), jede Nummer bekommt dann dieselbe Zeile.
export function jetztOffen(text: string): Map<string, { wer: string; wartet: string; rang: number }> {
  const aus = new Map<string, { wer: string; wartet: string; rang: number }>()
  const zeilen = text.split(/\r?\n/).filter(z => z.trim().startsWith('|'))
  const zellen = (z: string) => z.trim().replace(/^\||\|$/g, '').split('|').map(c => ohneMarkdown(c))
  const kopf = zellen(zeilen[0] ?? '')
  const spalte = (muster: RegExp) => kopf.findIndex(k => muster.test(k))
  const iPaket = spalte(/^paket/i)
  const iWer = spalte(/^wer/i)
  const iWartet = spalte(/^wartet/i)
  if (iPaket < 0) return aus
  let rang = 0
  for (const z of zeilen.slice(1)) {
    if (/^\|[\s:|-]*$/.test(z.trim())) continue          // Trennzeile |---|---|
    const c = zellen(z)
    const paket = c[iPaket] ?? ''
    const eintrag = { wer: iWer < 0 ? '' : (c[iWer] ?? ''), wartet: iWartet < 0 ? '' : (c[iWartet] ?? ''), rang: rang++ }
    for (const nr of (paket.split('·')[0] ?? '').match(/[A-Za-z]*-?\d+/g) ?? []) {
      if (!aus.has(nr)) aus.set(nr, eintrag)
    }
  }
  return aus
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

  // Pakete: "### 3 · Titel" (bis 29.10.2026 auch "### P-3 · Titel"), darin "- **Stand:** …".
  // Einsortiert nach der Tabelle "Jetzt offen", in ihrer Reihenfolge (das dringlichste oben).
  const tabelle = jetztOffen(abschnitt(teile, 'Jetzt offen'))
  const pakete: (Punkt & { rang: number })[] = []
  for (const block of abschnitt(teile, 'Pakete').split(/^### +/m).slice(1)) {
    const kopf = block.split(/\r?\n/)[0] ?? ''
    const m = /^(\S+)\s*[·:–-]\s*(.+)$/.exec(kopf.trim())
    const nr = m ? (m[1] ?? '') : ''
    const name = ohneMarkdown(m ? (m[2] ?? '') : kopf)
    const stand = ohneMarkdown(/^- \*\*Stand:\*\*\s*([\s\S]*?)(?=^- \*\*|^###|$(?![\s\S]))/m.exec(block)?.[1] ?? '')
    if (FERTIG.test(stand)) continue
    const zeile = tabelle.get(nr)
    const wartetAuf = zeile === undefined || WARTET_NICHT.test(zeile.wartet) ? '' : zeile.wartet
    const gruppe: Punkt['gruppe'] = zeile !== undefined && (BEIM_NUTZER.test(zeile.wer) || BEIM_NUTZER.test(wartetAuf))
      ? 'dich'
      : wartetAuf !== '' ? 'wartet' : 'startklar'
    const paket = nr === '' ? `das Paket „${name}“` : `das Paket ${nr} „${name}“`
    pakete.push({
      art: 'paket',
      gruppe,
      wartetAuf,
      titel: nr === '' ? name : `${nr} · ${name}`,
      zusatz: kuerze(stand, 140),
      prompt: gruppe === 'startklar'
        ? `Nimm dir aus der ${datei} ${paket} vor und arbeite es bis zum Erfolgskriterium ab.`
        : gruppe === 'dich'
          ? `Zu ${paket} aus der ${datei}: Was muss ich dafür tun?`
          : `Zu ${paket} aus der ${datei}, es wartet auf: ${wartetAuf}. Was ist der Stand, und kann es weitergehen?`,
      rang: zeile?.rang ?? Number.MAX_SAFE_INTEGER,
    })
  }
  // sort ist stabil: Pakete ohne Zeile in der Tabelle behalten ihre Reihenfolge am Ende
  for (const { rang: _rang, ...p } of pakete.sort((a, b) => a.rang - b.rang)) liste.push(p)

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
      gruppe: 'dich',
      wartetAuf: '',
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

// Titel eines Eintrags fuer seine Zeile im Panel: ohne Verweis in Klammern am Ende, etwa
// "Gemini als Fremdprüfer beibehalten (Paket 6, lohnt sich Gemini)" → "… beibehalten"
export function einzeilig(titel: string): string {
  const kurz = titel.replace(/\s*\([^()]*\)\s*$/, '')
  return kurz === '' ? titel : kurz
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
    const pfad = await read($, pfadZeigen)
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

    // Eine Gruppe des Blocks. Der Schluessel eines Eintrags zaehlt je Art (Paket oder Punkt aus
    // "Offen") ueber den ganzen Block, damit er gleich bleibt, egal in welcher Gruppe er steht.
    // In "Wartet" steht unter jedem Paket blass, worauf es wartet, auf einer Zeile. Im Knopf selbst
    // ginge das verloren, die App zeichnet dort nur das erste Textstueck (18.10.2026).
    const gruppe = (b: Block, nr: number, welche: Punkt['gruppe'], ueberschrift: string) => {
      const eintraege = b.liste.filter(x => x.gruppe === welche)
      if (eintraege.length === 0) return null
      const schluessel = (x: Punkt) => `b${nr}-${x.art}-${b.liste.filter(y => y.art === x.art).indexOf(x)}`
      return (
        // gap "sm": etwas Abstand zwischen den Eintraegen, damit sie sich voneinander abheben, ohne
        // eine ganze Leerzeile (Wunsch des Nutzers, 29.10.2026). Jeder Eintrag beginnt mit "•"
        <Box key={`b${nr}-gruppe-${welche}`} flexDirection="column" gap="sm">
          {/* Gruppenueberschrift fett, nicht mehr blass (Wunsch des Nutzers, 29.10.2026) */}
          <Text weight="bold">{ueberschrift}</Text>
          {eintraege.map(x => (
            <Box key={`${schluessel(x)}-zeile`} flexDirection="column">
              {/* Ein Eintrag ist nur noch sein Titel, ohne Stand dahinter und ohne Verweis in
                  Klammern am Ende. Mit beidem war er bis zu 217 Zeichen lang und auch im ganz
                  aufgezogenen Panel nicht zu Ende lesbar (Wunsch des Nutzers, 29.10.2026). Der
                  laengste Titel der geprueften Auftragsdateien hat so 78 Zeichen */}
              <Button key={schluessel(x)} plain onPress={() => fuelle($, x.prompt)}>
                <Text>{`• ${einzeilig(x.titel)}`}</Text>
              </Button>
              {welche === 'wartet'
                ? <Box marginLeft={2} height={1} overflow="hidden">
                    <Text dimColor wrap="truncate-end">{`auf ${x.wartetAuf}`}</Text>
                  </Box>
                : null}
            </Box>
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
              {/* Seit 29.10.2026 klappt die ganze Kopfzeile um, auch der Titel (Wunsch des Nutzers).
                  Dafuer liegt ueber der Zeile ein Knopf ohne sichtbaren Text, aus geschuetzten
                  Leerzeichen so breit wie das Panel. Darunter bleiben Titel, Farbe und Fett sichtbar.
                  Der Pfad der Datei steht nicht mehr im Block. Er erscheint als kleines Pop-up unter
                  der Kopfzeile, nur auf Klick auf ⓘ am rechten Rand, ein zweiter Klick verbirgt ihn.
                  Gewuenscht war Strg plus Darueberfahren, damit das Pop-up nur auf Absicht erscheint.
                  Das ist nicht baubar: Die App meldet einem Mod beim Darueberfahren weder Zeiger noch
                  Tasten, und eigene Zeichenmodule (Client), die das koennten, fuehrt die Desktop-App
                  noch nicht aus (Schnittstelle 2.1.309). Ein Pop-up bei blossem Darueberfahren
                  erschien dem Nutzer zu oft (29.10.2026). Der unsichtbare Knopf laesst rechts Platz
                  fuer ⓘ, damit beide getrennt klickbar sind. */}
              {/* Die Zeile ist fest eine Zeile hoch, nur der Titel darf schrumpfen. Bis 29.10.2026 brach
                  bei langem Titel die Zahl um („1“ / „offen“), die Zeile wurde zwei Zeilen hoch, und
                  der unsichtbare Knopf sass auf Hoehe der Zahl statt der Ueberschrift (Screenshot des
                  Nutzers). Zahl und Wort sind deshalb mit einem geschuetzten Leerzeichen verbunden und
                  stehen in einem Kasten, der nicht schrumpft. */}
              <Box key={`b${nr}-kopfzeile`} position="relative" flexDirection="row" alignItems="center" gap={1} height={1}>
                <Box flexShrink={0}><Text>{offen ? '▾' : '▸'}</Text></Box>
                <Box flexShrink={1} flexGrow={1} minWidth={0} height={1} overflow="hidden">
                  <Text weight="bold" color="claude" wrap="truncate-end">{kurztitel(b.titel).kurz}</Text>
                </Box>
                <Box flexShrink={0} height={1}><Text dimColor wrap="truncate-end">{`${b.liste.length} offen`}</Text></Box>
                <Box position="absolute" top={0} left={0} right={3} height={1} overflow="hidden">
                  <Button key={`b${nr}-kopf`} plain onPress={() => umklappen(b.datei, offen)}>{FUELLER.repeat(Math.max(8, Math.floor((e.props.bodyColumns - 3) * FUELLER_ANTEIL)))}</Button>
                </Box>
                <Box flexShrink={0}>
                  <Button key={`b${nr}-pfad`} plain dimColor onPress={() => update($, pfadZeigen, p => (p === b.datei ? '' : b.datei))}>ⓘ</Button>
                </Box>
                {pfad === b.datei
                  ? <Box position="absolute" top={1} left={2} backgroundColor="text" paddingX={1}>
                      <Text color="inverseText">{b.datei}</Text>
                    </Box>
                  : null}
              </Box>
              {offen && kurztitel(b.titel).rest !== '' ? <Text>{kurztitel(b.titel).rest}</Text> : null}
              {/* Gruppen seit 29.10.2026 nach Wunsch des Nutzers, eingeteilt nach der Tabelle "Jetzt
                  offen" (siehe jetztOffen). Vorher hiessen sie "Pakete" und "Offen", das sagte nicht,
                  was die Punkte sind */}
              {offen ? gruppe(b, nr, 'startklar', 'Startklar') : null}
              {offen ? gruppe(b, nr, 'dich', 'Braucht dich') : null}
              {offen ? gruppe(b, nr, 'wartet', 'Wartet') : null}
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
