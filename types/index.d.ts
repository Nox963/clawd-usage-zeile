export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Messung = {
  limits: Limit[]
  kontextTokens?: number
  kontextFenster: number
  kontextProzent?: number
  geschaetzt?: boolean                                 // Kontext lokal geschaetzt, etwa nach /compact
}

// Eine Szene, wie sie als JSON-Datei in szenen\ liegt. Die Dateien sind von einem
// Python-Werkzeug erzeugt, das nicht in diesem Repository liegt.
export type Szene = {
  key: string
  titel: string
  text: string                                         // was Clawd tut
  handlung: string                                     // was er zwischendurch macht, oder leer
  svg: string; breite: number; hoehe: number           // ganzer Ablauf, fuer die Zeile
  vorschau: string; vbreite: number; vhoehe: number    // nur die Arbeit, fuer die Auswahl
  nr?: number                                          // Reihenfolge; neue Szenen haben keine
}

declare module 'claude-code' {
  interface PluginState {
    'usage-zeile': { messung: Messung | null; jetzt: number; an: boolean; clawd: string; szenen: Szene[]
      auswahlOffen: boolean; spielt: string; favoriten: string[]; kartenStart: number
      ansicht: { fuenf: boolean; woche: boolean; kontext: boolean }; schwelle: number | null
      vorher: number | null; verdichtet: boolean; zeilen: Record<string, string> | null
      arbeitet: boolean; agenten: Record<string, number> }                 // fuer die Zeile unter jeder Antwort
  }
}
