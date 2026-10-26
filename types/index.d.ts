export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Messung = {
  limits: Limit[]
  kontextTokens?: number
  kontextFenster: number
  kontextProzent?: number
  geschaetzt?: boolean                                 // Kontext lokal geschaetzt, etwa nach /compact
}

// Eine Szene, wie sie als JSON-Datei in szenen\ liegt. Gebaut von
// Desktop\Claude-Maskottchen\clawd\usage_zeile\baue_mod_daten.py.
export type Szene = {
  key: string
  titel: string
  text: string                                         // was Clawd tut
  handlung: string                                     // was er zwischendurch macht, oder leer
  svg: string; breite: number; hoehe: number           // ganzer Ablauf, fuer die Zeile
  vorschau: string; vbreite: number; vhoehe: number    // nur die Arbeit, fuer die Auswahl
  nr?: number                                          // Reihenfolge; neue Szenen haben keine
}

// Ein offener Punkt der AUFTRAG.md fuer das Panel (hooks\punkte.tsx)
export type Punkt = {
  art: 'paket' | 'offen'
  titel: string
  zusatz: string                                       // Stand des Pakets oder Rest des Punkts, gekuerzt
  prompt: string                                       // was ein Klick ins Eingabefeld schreibt
}
export type Punkte = { titel: string; ordner: string; liste: Punkt[] }
// Ein Block im Panel: eine Auftragsdatei mit ihren offenen Punkten (seit 18.10.2026)
export type Block = Punkte & { datei: string; mtimeMs: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-zeile': { messung: Messung | null; jetzt: number; an: boolean; clawd: string; szenen: Szene[]
      auswahlOffen: boolean; spielt: string; favoriten: string[]; kartenStart: number
      ansicht: { fuenf: boolean; woche: boolean; kontext: boolean }; schwelle: number | null
      vorher: number | null; verdichtet: boolean; zeilen: Record<string, string> | null
      arbeitet: boolean; agenten: Record<string, number>   // fuer die Zeile unter jeder Antwort
      auftrag: { beginn: number; kontextDavor: number | null; verdichtet: boolean; verb: string; schluesse: string[] } | null
      neuerAuftrag: boolean
      punkteGelesen: number                                // fuer das Panel der offenen Punkte
      punkteAuf: Record<string, boolean> }                 // je Auftragsdatei aufgeklappt oder zu
  }
}
