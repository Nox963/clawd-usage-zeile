# Usage-Zeile mit Clawd

*English: A mod for Claude Code that shows your 5-hour limit, weekly limit and context usage
above the prompt, with an animated pixel Clawd next to it. The interface is mostly in German.*

Ein Mod für Claude Code. Ein Mod ist eine kleine Erweiterung, die Claude Code beim Start
mitlädt. Dieser zeichnet über dem Eingabefeld eine Zeile mit drei Angaben und einem
animierten Clawd:

```
🕖 5 % (4 h 7 min) · 📆 23 % (4 Tage 14 h) · ◔ 632k/1M (63 %)              [Clawd]
```

* **🕖** ist das 5-Stunden-Limit, in Klammern die Zeit bis zum Zurücksetzen.
* **📆** ist das Wochenlimit, in Klammern Tage und Stunden bis zum Zurücksetzen.
* **Der Ring** füllt sich mit dem Kontext, also mit dem, was Claude in dieser Sitzung im
  Gedächtnis hält.
* **Clawd** steht rechts und spielt die gewählte Szene, solange Claude arbeitet. Sonst
  steht er still.

Unter die letzte Antwort eines Auftrags setzt der Mod außerdem eine Zeile wie
`Claude cooked for 45m 28s · +84k · done 23:02`. Die Zeit läuft von der eigenen Eingabe bis
zum Ende, auch während Agenten im Hintergrund arbeiten. Die Zahl ist der Beitrag des Auftrags
zum Kontext, `done` die Uhrzeit, zu der er fertig war.

Auf Wunsch kommt ein Panel „Offene Punkte“ dazu. Es zeigt neben dem Gespräch die offenen
Pakete und Punkte aus `AUFTRAG.md`-Dateien im Arbeitsordner, je Datei ein Block, eingeteilt in
„Startklar“, „Braucht dich“ und „Wartet“. Grundlage der Einteilung ist die Tabelle „Jetzt offen“
in der Datei. „Braucht dich“ erkennt der Mod am Wort `Nutzer` oder an einem Entscheid in den
Spalten „Wer ist dran“ und „Wartet auf“. Ein Klick auf ⓘ zeigt den Pfad der Datei.

> **Inoffizielles Fanprojekt.** Dieser Mod ist nicht von Anthropic und steht in keiner
> Verbindung zu Anthropic. Claude und Claude Code sind Marken von Anthropic. Clawd ist das
> Maskottchen von Claude Code. Die Pixelzeichnungen in `szenen/` sind eigene Zeichnungen
> dieser Figur. Rechte an Figur und Marke liegen bei Anthropic, nicht bei diesem Projekt.

## Voraussetzungen

* **Claude Code mit Unterstützung für Mods.** Getestet mit der Fassung 2.1.309, die die
  Claude-Desktop-App im Code-Bereich mitbringt. Ältere Fassungen im Terminal kennen keine
  Mods.
* **Clawd erscheint nur in der Desktop-App.** Im Terminal zeigt die Zeile nur die Zahlen,
  weil das Terminal die Grafiken nicht zeichnet.
* **Die beiden Limits gibt es nur mit einem Claude-Abo.** Mit einem API-Schlüssel bleibt
  nur der Kontext.
* Die Zeile passt sich schmalen Fenstern nicht an. Gedacht ist sie für ein breites Fenster.

## Installieren

**In der Desktop-App:** Auf das + neben dem Eingabefeld klicken, dann *Plugins*, dann
*Add marketplace* mit `Nox963/clawd-usage-zeile`, dann *Add plugin* und `usage-zeile` wählen.

**Im Terminal, in einer laufenden Sitzung von Claude Code:**

```
/plugin install usage-zeile --marketplace Nox963/clawd-usage-zeile
```

Die Frage `Add marketplace?` mit `y` beantworten und als Bereich *user* wählen. Dann gilt
der Mod für jede neue Sitzung.

**Aus einer Shell:**

```bash
claude plugin install usage-zeile --marketplace Nox963/clawd-usage-zeile
```

Danach Claude Code neu starten. Die Desktop-App ganz schließen, auch im Hintergrund.

## Teile auswählen

Der Mod besteht aus vier Teilen. Jeder lässt sich einzeln abschalten:

| Einstellung | Teil | Voreinstellung |
|---|---|---|
| `zahlen` | Limits und Kontext-Ring in der Zeile | an |
| `clawd` | animierter Clawd mit Auswahl der Szenen und Favoriten | an |
| `antwortzeile` | Zeile unter der letzten Antwort eines Auftrags | an |
| `panel` | Knopf ≡ und Panel „Offene Punkte“ | aus |

Claude Code fragt die Einstellungen bei der Installation ab. Später ändert man sie im
Terminal über `/config`, dort stehen sie unter `usage-zeile`. Danach lädt der Mod neu.

## Aktualisieren

Neue Szenen und Verbesserungen kommen als neue Fassung. So holt man sie:

```bash
claude plugin marketplace update clawd-usage-zeile
```

```bash
claude plugin update usage-zeile@clawd-usage-zeile
```

Danach Claude Code neu starten.

## Bedienung

* **Schiebeschalter ganz links** schaltet die Zeile an und aus.
* **Punkt oben rechts** klappt die Auswahl der Szenen auf. Darunter steht **≡**, wenn das
  Panel eingeschaltet ist. Es öffnet die offenen Punkte neben dem Gespräch. Jede Karte zeigt eine Vorschau.
  *Preview* zeigt den ganzen Ablauf, *Use* übernimmt die Szene. Die Auswahl zeigt sechs Szenen
  je Seite, ◀ und ▶ in der Kopfzeile blättern.
* **Stern auf einer Karte** macht die Szene zum Favoriten. Favoriten stehen oben.
* **Klick auf eine Anzeige** zeigt Details. Bei 🕖 und 📆 die Uhrzeit des Zurücksetzens,
  beim Ring, ab welcher Füllung Claude Code den Kontext automatisch verdichtet.
* Nach `/compact` oder `/clear` ist die Kontextzahl bis zur nächsten Antwort geschätzt und
  steht mit ≈ da.

Der Mod merkt sich Schalter, Szene und Favoriten über Sitzungen hinweg. Ein paar kleine
Dateien legt er dafür neben seinen eigenen Ordner: `usage-zeile-limits.json`,
`usage-zeile-favoriten.json`, `usage-zeile-antwortzeilen.json` und
`usage-zeile-herkunft.txt` (die Herkunft der letzten 50 Eingaben, zur Prüfung der Zeile unter
der Antwort). Das Panel liest zusätzlich `usage-zeile-ordner.json`, falls vorhanden. Nach
außen schickt der Mod nichts.

## Szenen

Jede Szene ist eine JSON-Datei in `szenen/` mit zwei SVG-Grafiken, dem ganzen Ablauf und
einer kleinen Vorschau. Der Mod liest den Ordner bei jedem Öffnen der Auswahl. Eine Datei,
die sich nicht lesen lässt, überspringt er.

## Einen neuen Clawd wünschen

Wer eine Szene vermisst, kann sie über das Formular
[Neuer Clawd](../../issues/new?template=neuer-clawd.yml) wünschen. Gefragt wird, was
Clawd tun soll, was dazugehört und was er zwischendurch machen könnte. Angenommene Wünsche
kommen mit einer der nächsten Fassungen.

Fehler meldet man über [Fehler melden](../../issues/new?template=fehler.yml).

## Prüfen

Wer am Mod etwas ändert, prüft ihn mit:

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

## Lizenz

Der Code steht unter der MIT-Lizenz, siehe [LICENSE](LICENSE). Für die Figur Clawd gilt der
Hinweis oben. Die Lizenz gibt keine Rechte an Marken oder Figuren von Anthropic.
