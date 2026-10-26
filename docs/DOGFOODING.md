# DOGFOODING — 2-Wochen-Anleitung

Status: **Vorbereitung**. Das Dogfooding startet erst nach **Human Gate 3**
(Go-Live-Freigabe). Dieses Dokument beschreibt den Ablauf; es enthält keine
Testergebnisse. Ergebnisse werden ausschließlich in [`FEEDBACK.md`](FEEDBACK.md)
erfasst. Die PLAN-Checkbox **T5.5 bleibt offen**, bis das Dogfooding real
abgeschlossen und die Bugfix-Runde durchgeführt ist.

Ziel: Den Einkaufszettel zwei Wochen lang im echten Haushaltsalltag nutzen —
insbesondere einhändig im Supermarkt, offline und mit mehreren Geräten — und
belastbares Feedback für die Bugfix-Runde zu sammeln.

---

## 1. Teilnehmende Haushalte und Rollen

| Haushalt                               | Teilnehmende | Rollen in der App                         | Geräte                                         |
| -------------------------------------- | ------------ | ----------------------------------------- | ---------------------------------------------- |
| H1 (eigener Haushalt)                  | 2 Personen   | 1× `owner`, 1× `editor`                   | 2 Smartphones (Android/iOS), 1 Tablet optional |
| H2 (zweiter Haushalt, falls verfügbar) | 1–2 Personen | `owner`; zusätzlich 1× `viewer` zum Lesen | 1 Smartphone, 1 Desktop-Browser                |
| H3 (optional, technikfern)             | 1 Person     | `editor` nach Einladung                   | 1 Smartphone                                   |

Regeln:

- **Mindestens H1** muss vollständig teilnehmen (2 Personen, 2 Geräte).
- H2/H3 sind optional und dienen der Rollen- und Einladungsprüfung. Fällt ein
  Haushalt aus, ist das kein Abbruchgrund; es wird im Feedback vermerkt.
- Jede Person nutzt ein eigenes Konto (keine geteilten Logins), damit
  Rollenwechsel und Geräte-Sync ehrlich getestet werden.
- **Rollen:** `owner` (verwaltet Haushalt, Mitglieder, Einladungen), `editor`
  (Listen und Rezepte lesen/schreiben), `viewer` (nur lesen). Die Rechte werden
  in der App durchgesetzt; ein `viewer` darf nichts schreiben.
- Keine echten Adressen, Klarnamen Dritter oder Zahlungsdaten in Feedback
  eintragen. Vorname/Haushaltskürzel genügt.

## 2. Zeitplan und Rhythmus

| Phase            | Zeitraum | Inhalt                                                                                                                        |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Kickoff          | Tag 0    | Konten anlegen, Haushalte einrichten, PWA installieren, dieses Dokument und `FEEDBACK.md` lesen; Known Issues prüfen.         |
| Woche 1          | Tag 1–7  | Alle Kern-Testfälle mindestens einmal durchlaufen; Alltag: Einkauf mit Liste, Rezepte übernehmen, Teilen/Einladen.            |
| Wochen-Review 1  | Tag 7    | Feedback sichten, Blocker/hoch priorisieren, Umgehungen festlegen.                                                            |
| Woche 2          | Tag 8–14 | Wiederholung der Kernfälle unter Alltagsbedingungen; gezielt Grenzfälle (offline, Rollenwechsel, Dark Mode); Bugfix-Nachtest. |
| Abschluss-Review | Tag 14   | Abschlussbewertung, Restdefekte, Entscheidung über Bugfix-Runde/Go-Live-Empfehlung.                                           |

Täglicher Rhythmus (empfohlen, nicht zwingend):

- **Morgen (5 Min.):** Einkaufsliste für den Tag prüfen, Artikel ergänzen.
- **Einkauf:** Liste einhändig bedienen; Offline-Verhalten beobachten.
- **Abend (5–10 Min.):** Beobachtungen in `FEEDBACK.md` eintragen, offene
  Einträge präzisieren (Reproduktion, Erwartung/Ist, Screenshot-Hinweis).
- **Feedback-Sichtung:** täglich kurz (10 Min.) neue Einträge triagieren;
  wöchentlich vertieft (30–45 Min.) priorisieren und Bugfix-Runde planen.

## 3. Kern-Testfälle

Jeder Fall wird in Woche 1 und Woche 2 mindestens einmal real durchlaufen.
Szenario-IDs werden im Feedback referenziert. „Bestanden“ heißt: Erwartung
erfüllt, ohne Blocker; Abweichungen werden als Feedback erfasst.

### D1 — Liste anlegen und im Alltag führen

- **Ziel:** Eine neue Liste anlegen, Artikel hinzufügen, abhaken, bearbeiten,
  löschen (mit Undo) und die Liste über den Tag nutzen.
- **Schritte:** Liste „Wocheneinkauf“ anlegen → 8–12 Artikel in ≤2 Taps je
  Artikel hinzufügen → 2 Artikel abhaken → 1 Artikel-Menge ändern → 1 Artikel
  löschen und Undo prüfen → App schließen und erneut öffnen.
- **Erwartung:** Alle Änderungen bleiben erhalten; abgehakte Artikel stehen
  unten; keine Doppel-Einträge bei schnellem Tippen; Undo stellt den Artikel
  wieder her.

### D2 — Liste mit zweitem Haushaltsmitglied teilen

- **Ziel:** `owner` lädt `editor` per Link/QR ein; beide sehen und ändern
  dieselbe Liste; Rollen und Rechte wirken.
- **Schritte:** Einladung erzeugen → auf Gerät 2 einlösen → Liste auf beiden
  Geräten öffnen → Gerät 1 fügt Artikel hinzu → Gerät 2 prüft Sichtbarkeit →
  Gerät 2 hakt ab → Gerät 1 prüft Status → `viewer` einladen und Schreibversuch
  prüfen.
- **Erwartung:** Einladung nur einmal gültig; Änderungen erscheinen zeitnah
  (Ziel <2 s bei Verbindung); `viewer` kann nicht schreiben; Rechte-Fehler sind
  verständlich.

### D3 — Offline im Supermarkt

- **Ziel:** Ohne Netz einkaufen, abhaken, Artikel ergänzen; nach Reconnect ohne
  Datenverlust synchronisieren.
- **Schritte:** Flugmodus an → Liste öffnen (muss aus lokalem Cache laden) →
  Artikel abhaken und 2 neue Artikel hinzufügen → App schließen/öffnen →
  Flugmodus aus → Sync-Status beobachten → Inhalt auf Gerät 2 prüfen.
- **Erwartung:** Offline les- und schreibbar; ehrlicher Sync-Status („offline“,
  „ausstehend“, „synchronisiert“); nach Reconnect keine Duplikate/Verluste;
  dauerhaft fehlgeschlagene Einträge erscheinen im Dead-Letter-Panel mit
  „Erneut versuchen“/„Verwerfen“.

### D4 — Rezept übernehmen und Portionen skalieren

- **Ziel:** Rezept anlegen/öffnen, Portionen ändern, Zutaten auswählen und auf
  die Einkaufsliste übertragen.
- **Schritte:** Rezept mit ≥5 Zutaten anlegen → Portionen 4→6 ändern →
  „Auf die Einkaufsliste“ → Vorschau prüfen (Mengen, bereits vorhandene
  Zutaten) → übertragen → gleiche Zutaten erneut übertragen → Liste prüfen.
- **Erwartung:** Mengen korrekt skaliert und gerundet; vorhandene Zutaten
  addieren Mengen mit Hinweis; inkompatible Einheiten als eigene Zeile;
  `source_recipe_id` gesetzt (in der UI nachvollziehbar).

### D5 — Einladung, Rollen und Mitgliederverwaltung

- **Ziel:** Einladung mit Ablauf/Widerruf, Rollenwechsel, Entfernen eines
  Mitglieds, Schutz des letzten Owners.
- **Schritte:** Einladung mit Ablauf erzeugen → nach Ablauf einlösen →
  widerrufene Einladung einlösen → Rolle `editor`→`viewer` ändern → Mitglied
  entfernen → letzte `owner`-Rolle zu wechseln versuchen.
- **Erwartung:** Abgelaufene/widerrufene Links werden klar abgelehnt;
  Rollenwechsel wirkt sofort; entferntes Mitglied verliert Zugriff; der letzte
  Owner kann nicht degradiert/entfernt werden.

### D6 — Dark Mode und Mobile-Ergonomie

- **Ziel:** Dark Mode (System und manueller Toggle) sowie einhändige Bedienung
  auf 320–430 px prüfen.
- **Schritte:** System auf Dark stellen → App prüfen → Toggle setzen und App
  neu laden (Persistenz) → reduzierte Bewegung aktivieren → einhändig (Daumen)
  Artikel hinzufügen/abhaken/löschen → Touch-Ziele und Kontrast prüfen.
- **Erwartung:** Kein Flash beim Laden; Toggle bleibt erhalten; alle
  Kernaktionen mit einer Hand erreichbar; Touch-Ziele ≥44 px; sichtbarer Fokus;
  `prefers-reduced-motion` wird respektiert; kein horizontaler Scrollbalken.

### D7 — Installation als PWA und Alltagstauglichkeit

- **Ziel:** App auf dem Homescreen installieren und wie eine App starten;
  Verhalten bei Update/Neustart prüfen.
- **Schritte:** Installation über Browser-Menü (HTTPS-Kontext) → Start vom
  Homescreen → Liste öffnen → App schließen → erneut starten → Update
  installieren (falls angeboten) → Daten prüfen.
- **Erwartung:** Installierbar, Start ohne Browserleiste, Daten bleiben lokal
  erhalten; Update führt nicht zu Datenverlust; Offline-Start funktioniert.

### D8 — Haushalts-Sichtbarkeit (Datenschutz)

- **Ziel:** Fremde Haushalte sind nicht sichtbar; `viewer` sieht nur den
  eingeladenen Haushalt.
- **Schritte:** Mit Konto aus H2 anmelden → Haushaltsliste prüfen → direkte
  URL/ID eines fremden Haushalts versuchen.
- **Erwartung:** Keine fremden Haushalte/Listen sichtbar; Zugriff wird
  verweigert (verständliche Meldung, kein Datenleck).

## 4. Known Issues und Umgehungen (Stand vor Dogfooding)

Diese Liste wird **vor dem Start** mit dem dann aktuellen Stand abgeglichen.
Sie enthält keine erfundenen Beobachtungen, sondern den dokumentierten
Projektstand (u. a. `docs/REVIEW.md`, `docs/DECISIONS.md`, `docs/BACKLOG.md`).

| #   | Known Issue / Einschränkung                                                                                                | Auswirkung im Dogfooding                                                                      | Umgehung                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| K1  | **PWA-Installation benötigt HTTPS.** In der Sandbox fehlt ein Docker-Daemon; der echte Compose-/HTTPS-Lauf ist offen (D3). | Installation/Service Worker evtl. nur auf echtem Host; `localhost` gilt als sicherer Kontext. | Auf produktionsnahem Host mit gültigem Zertifikat testen; Installation auf `localhost` nur für Funktionsprüfung.        |
| K2  | **Realtime im Dev-Mock per Polling (~1,5 s).**                                                                             | Änderungen anderer Geräte erscheinen verzögert.                                               | Als erwartetes Verhalten notieren; bei echtem Supabase-Realtime erneut prüfen.                                          |
| K3  | **Sync-Konflikte werden feldweise per LWW aufgelöst.**                                                                     | Bei gleichzeitiger Bearbeitung desselben Felds gewinnt der letzte Schreibvorgang.             | Nicht gleichzeitig dasselbe Feld bearbeiten; Konfliktfälle gezielt provozieren und als Feedback erfassen.               |
| K4  | **Dauerhaft fehlgeschlagene Outbox-Einträge** landen im Dead-Letter-Panel.                                                 | Artikel fehlt evtl. auf anderen Geräten.                                                      | Panel öffnen, „Erneut versuchen“; bei wiederholtem Fehler „Verwerfen“ und Artikel neu anlegen; Fehlertext ins Feedback. |
| K5  | **Kein Push, kein Barcode-Scan, kein Rezeptimport per URL, keine Vorratsliste** (Backlog).                                 | Diese Komfortfunktionen fehlen bewusst.                                                       | Nicht als Defekt melden; als Wunsch/Backlog notieren, falls schmerzhaft.                                                |
| K6  | **Echter Supabase-E2E-Lauf** (PostgREST/Realtime) in der Sandbox nicht möglich (Harness-Grenze).                           | Einladungs-/Haushaltsfehler können sandboxbedingt sein.                                       | Vor Dogfooding auf echtem Stack verifizieren; Harness-Fehler nicht als App-Defekt melden.                               |
| K7  | **Registrierung: `profiles`-Insert** war in der Sandbox offen (Review-Befund).                                             | Profil evtl. unvollständig.                                                                   | Bei fehlendem Profil erneut anmelden; Eintrag als Blocker/hoch erfassen.                                                |
| K8  | **Service-Worker-Cache** kann nach Deploy veraltete Assets liefern.                                                        | UI wirkt „alt“.                                                                               | Einmal neu laden/hart neu laden; bei Wiederholung Feedback mit Build-Zeitpunkt.                                         |

> Diese Tabelle ist ein Startpunkt. Wird ein Known Issue vor dem Start behoben,
> wird die Zeile entfernt und im Kickoff-Protokoll vermerkt. Neue Known Issues
> kommen **nur** aus realen Beobachtungen (siehe `FEEDBACK.md`).

## 5. Abbruch- und Eskalationskriterien

**Sofortiger Abbruch des Dogfoodings (Stop-Regel):**

1. **Datenverlust oder -beschädigung:** Artikel/Listen verschwinden nach
   Sync oder App-Neustart, ohne dass Undo/Dead-Letter hilft.
2. **Kein Zugriff mehr:** Login, Haushaltszugriff oder Einladung dauerhaft
   unmöglich (Aussperrung), auch nach Neustart/Reconnect.
3. **Falsche Rechte:** `viewer` kann schreiben oder fremde Haushalte sind
   sichtbar — Datenschutz-/Sicherheitsvorfall.
4. **Blocker im Supermarkt:** Liste lädt offline nicht oder Abhaken geht
   offline nicht; Einkauf ist mit der App nicht durchführbar.

**Eskalation (kein Abbruch, aber sofort melden):**

- Schweregrad **blocker** oder **hoch** (Definitionen in `FEEDBACK.md`).
- Wiederholte Sync-Fehler über >24 h oder >3 Dead-Letter-Fälle pro Woche.
- Ein Kern-Testfall (D1–D8) schlägt in Woche 2 erneut fehl, obwohl er in
  Woche 1 als bestanden galt (Regression).
- Sicherheits-/Datenschutzverdacht jeder Art.

**Eskalationsweg:** Eintrag in `FEEDBACK.md` mit Schweregrad, dann
Benachrichtigung an die verantwortliche Person (Product Owner/QA) mit
Feedback-ID. Bei Stop-Regel zusätzlich sofortiger Stopp des Dogfoodings und
Sicherung der lokalen Daten (Export/Screenshot der Liste, Browser-Konsole).

**Kein Abbruchgrund:** kosmetische Abweichungen, fehlende Backlog-Funktionen
(K5), bekannte Harness-Grenzen (K6), langsame Realtime im Mock (K2).

## 6. Feedback-Sichtung

| Rhythmus                | Wer                                   | Was                                                                                                    |
| ----------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Täglich, 10 Min.        | Product Owner + 1 teilnehmende Person | Neue Einträge triagieren: Schweregrad prüfen, Duplikate zusammenführen, Blocker sofort eskalieren.     |
| Wöchentlich, 30–45 Min. | Product Owner + QA                    | Priorisierung, Bugfix-Runde planen, Known-Issues-Tabelle aktualisieren, offene Einträge nachfragen.    |
| Nach Bugfix             | QA                                    | Betroffene Feedback-IDs nachtesten; Status auf „behoben“/„weiter offen“ setzen; Regressionstest D1–D8. |

Regeln für die Sichtung:

- Jeder Eintrag bekommt eine ID (`FB-001`, …) und genau einen Schweregrad.
- **Blocker** werden am selben Tag eskaliert, nicht erst im Wochenreview.
- Einträge ohne Reproduktion werden zurück an die meldende Person gegeben
  (Kommentar in `FEEDBACK.md`), nicht geraten.
- Erledigte Einträge bleiben stehen (Status „behoben“) — nicht löschen.

## 7. Abschluss und Bugfix-Runde

Am Tag 14:

1. Alle Einträge sind triagiert und haben einen Status.
2. Bugfix-Runde: Blocker + hoch beheben, mittel nach Aufwand, niedrig ggf.
   Backlog. Jeder Fix wird mit der Feedback-ID und einem Nachtest belegt.
3. Abschlussbewertung: Kern-Testfälle D1–D8 bestanden/nicht bestanden,
   Restdefekte, Empfehlung an das Go-Live-Gate.
4. Erst danach wird die PLAN-Checkbox **T5.5** getickt — nicht vorher.

## 8. Kickoff-Checkliste

- [ ] Konten für alle Teilnehmenden angelegt; Haushalte H1 (und ggf. H2/H3)
      eingerichtet.
- [ ] Rollen verteilt (`owner`, `editor`, ggf. `viewer`) und einmal geprüft.
- [ ] PWA auf allen Testgeräten installiert (HTTPS-Kontext).
- [ ] Known-Issues-Tabelle (Abschnitt 4) gegen den aktuellen Stand abgeglichen.
- [ ] `FEEDBACK.md` geöffnet und der Meldeweg (Abschnitt 5) allen bekannt.
- [ ] Review-Termine (Tag 7, Tag 14) im Kalender.
