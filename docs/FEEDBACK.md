# FEEDBACK — Dogfooding 2 Wochen

Dieses Dokument ist die **einzige** Ablage für Beobachtungen aus dem
Dogfooding. Ablauf und Testfälle stehen in [`DOGFOODING.md`](DOGFOODING.md).
Es enthält **noch keine Testergebnisse** — die Einträge entstehen erst während
des realen Dogfoodings nach Human Gate 3.

**So melden (3 Schritte):**

1. Eintrag unten aus der Vorlage kopieren, nächste freie ID vergeben
   (`FB-001`, `FB-002`, …).
2. Alle Pflichtfelder ausfüllen; Schweregrad nach der Tabelle in Abschnitt 2.
3. Bei **blocker/hoch** zusätzlich am selben Tag die verantwortliche Person
   (Product Owner/QA) mit der ID benachrichtigen. Screenshot nicht einbetten,
   sondern als Datei/Anhang referenzieren.

Regeln: Eine Beobachtung = ein Eintrag. Keine erfundenen Ergebnisse, keine
Vermutungen als Ist-Zustand. Einträge werden nicht gelöscht; Status wird
fortgeschrieben. Keine echten Adressen oder Klarnamen Dritter.

---

## 1. Vorlage (kopieren und ausfüllen)

```markdown
### FB-NNN — Kurztitel

- **Datum:** JJJJ-MM-TT, Uhrzeit (lokal)
- **Haushalt:** H1 / H2 / H3
- **Rolle:** owner / editor / viewer
- **Gerät & Browser:** z. B. iPhone 14, Safari 18.2 / Pixel 7, Chrome 131
- **Szenario:** D1 / D2 / D3 / D4 / D5 / D6 / D7 / D8 / außerhalb (kurz nennen)
- **Schweregrad:** blocker / hoch / mittel / niedrig
- **Reproduktion:** Nummerierte Schritte, mit Ausgangszustand (welche Liste,
  wie viele Artikel, online/offline, welche Geräte). Idealerweise 1× wiederholt.
- **Erwartung:** Was sollte passieren?
- **Ist:** Was ist tatsächlich passiert? Wörtliche Fehlermeldung/Code, falls
  vorhanden.
- **Häufigkeit:** einmalig / gelegentlich (x von y) / immer
- **Screenshot/Anhang:** Dateiname oder „keiner“ (nur wenn kein Screenshot
  möglich war, z. B. Datenverlust). Bei UI-/Layoutfehlern bitte Screenshot.
- **Konsole/Netzwerk:** relevante Fehlermeldung oder Request-Status, falls
  sichtbar (optional, aber hilfreich).
- **Status:** neu / triagiert / in Arbeit / behoben / weiter offen / Backlog
- **Bearbeiter:in / Fix-Referenz:** Name/Commit/PR (erst bei Bearbeitung)
```

## 2. Schweregrade

| Schweregrad | Definition                                                                                                                    | Reaktion                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **blocker** | Kern-Testfall D1–D8 nicht durchführbar, Datenverlust, Aussperrung, falsche Rechte/Datenschutz. Einkauf mit der App unmöglich. | Sofort eskalieren; Stop-Regel in `DOGFOODING.md` §5 prüfen.   |
| **hoch**    | Wichtige Funktion liefert falsches Ergebnis oder bricht reproduzierbar ab; erhebliche Umgehung nötig.                         | Innerhalb von 24 h triagieren, in laufende Bugfix-Runde.      |
| **mittel**  | Funktion eingeschränkt, aber mit akzeptabler Umgehung nutzbar; deutliche UX-Störung.                                          | Wöchentliche Priorisierung; Fix in Bugfix-Runde oder Backlog. |
| **niedrig** | Kosmetik, Tippfehler, kleine Unschönheit; kein Einfluss auf den Einkauf.                                                      | Sammeln, ggf. Backlog.                                        |

Ein Eintrag hat **genau einen** Schweregrad. Bei Unsicherheit: eine Stufe
höher einordnen und in der Sichtung korrigieren.

## 3. Ausfüllbeispiel (fiktiv — keine Messung)

> Dieses Beispiel ist **erfunden** und dient nur dem Format. Es ist kein
> Testergebnis und darf nicht als Nachweis zitiert werden.

```markdown
### FB-000 — Beispiel: Abhaken bei Flugmodus geht verloren

- **Datum:** 2026-11-03, 18:42
- **Haushalt:** H1
- **Rolle:** editor
- **Gerät & Browser:** iPhone 14, Safari 18.2
- **Szenario:** D3
- **Schweregrad:** hoch
- **Reproduktion:**
  1. Liste „Wocheneinkauf“ mit 10 Artikeln öffnen (online, synchronisiert).
  2. Flugmodus aktivieren, App in den Hintergrund schicken, wieder öffnen.
  3. Artikel „Milch“ abhaken.
  4. App schließen (Homescreen) und erneut öffnen.
- **Erwartung:** „Milch“ bleibt abgehakt, Status zeigt „ausstehend“ und
  synchronisiert nach Reconnect.
- **Ist:** „Milch“ ist nach dem Neustart wieder offen; kein Dead-Letter-Eintrag.
- **Häufigkeit:** immer (3 von 3 Versuchen).
- **Screenshot/Anhang:** `fb-000-liste-nach-neustart.png` (Status „offline“).
- **Konsole/Netzwerk:** keine Fehlermeldung sichtbar.
- **Status:** neu
- **Bearbeiter:in / Fix-Referenz:** —
```

## 4. Feedback-Log

Neue Einträge unten anhängen. Sortierung nach ID, nicht nach Datum.

<!-- Ab hier Einträge einfügen. Nichts vor dem Dogfooding eintragen. -->

## 5. Sichtungsprotokoll (Triage)

| Datum | FB-IDs | Ergebnis / Entscheidung         | Wer |
| ----- | ------ | ------------------------------- | --- |
| —     | —      | Noch kein Dogfooding gestartet. | —   |

## 6. Bugfix-Runde — Nachtest

| FB-ID | Schweregrad | Fix (Commit/PR) | Nachtest am | Ergebnis | Wer |
| ----- | ----------- | --------------- | ----------- | -------- | --- |
| —     | —           | —               | —           | —        | —   |

## 7. Abschlussübersicht

| Kennzahl                                | Wert          |
| --------------------------------------- | ------------- |
| Einträge gesamt                         | —             |
| davon blocker / hoch / mittel / niedrig | — / — / — / — |
| behoben                                 | —             |
| weiter offen                            | —             |
| Backlog                                 | —             |
| Kern-Testfälle D1–D8 bestanden          | — von 8       |
| Empfehlung an Go-Live-Gate              | —             |

> Erst nach realem Abschluss ausfüllen. Die PLAN-Checkbox T5.5 wird erst
> danach getickt.
