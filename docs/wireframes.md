# Wireframes (Low-Fi) — Liste, Rezept, Import-Dialog

> **Status:** Entwurf für **Human Gate 1** (T1.6b). Reine Dokumentation — kein App-Code.
> **Bezug:** `PLAN.md` §4.2 (Sync/LWW), §4.3 (Einheiten), §4.4 (Kategorien), §5 T2.6/T3.2/T3.4, Anhang A (A-5/A-6).
> **Grundprinzip:** Mobile-first, **Ein-Hand-Bedienung** im Supermarkt. Alle primären
> Touch-Ziele **≥ 44 px** hoch, die Add-Zeile sitzt **unten** (Daumenreichweite),
> Abhaken ist **ein Tap**, Hinzufügen **≤ 2 Taps** ab Listenansicht.

Die Skizzen sind bewusst Low-Fi (Text/ASCII). Sie legen **Anordnung und Interaktion**
fest, nicht Farben, Typografie oder exakte Abstände. Jede Skizze ist ein Handy-Hochformat
(360 × 640 dp); `═══` markiert den sichtbaren Viewport-Rand, `───` eine Trennlinie.

## 0. Globale Layout-Regeln

| Regel | Umsetzung | Grund |
|---|---|---|
| Add-Zeile unten fixiert | Eingabefeld + „+“-Button in einer Bottom-Bar über der Tab-Bar; bei Tastatur nach oben geschoben | Daumen erreicht unten, nicht oben |
| Große Tap-Targets | Zeile ≥ 56 px, Checkbox-Trefferfläche ≥ 44 × 44 px (unsichtbar vergrößert) | Supermarkt, einhändig, evtl. Handschuhe |
| Abhaken = 1 Tap | Ganze linke Checkbox-Fläche schaltet `checked` um; kein Kontextmenü | Schnellster Kernpfad |
| Abgehakte Artikel unten | Eigene Sektion „Erledigt (n)“ unter den offenen, einklappbar | Offene Artikel bleiben sichtbar |
| Sync-Status immer sichtbar | Chip in der Kopfzeile: `synchronisiert` / `ausstehend: n` / `offline` | Local-first (PLAN §4.2) |
| Kategorien-Gruppierung | Offene Artikel nach Kategorie (§4.4), Überschriften sticky | Scanbarkeit im Laden |
| Destruktives mit Undo | Löschen entfernt sofort, Toast „Gelöscht – Rückgängig“ (5 s) | Kein Bestätigungsdialog |
| Kein Modal für Alltägliches | Hinzufügen und Abhaken ohne Dialog; nur Bearbeiten/Import als Sheet | Weniger Reibung |

---

## 1. Skizze A — Einkaufsliste (Hauptansicht)

Zweck: offene Artikel schnell erfassen und im Laden abhaken. Kontext: Haushalt + Liste
„Wocheneinkauf“.

```text
══════════════════════════════════════════════════
  ←  Wocheneinkauf              [sync: ok]     ⋮
     Haushalt Müller · 2 Mitglieder
──────────────────────────────────────────────────
  [ suchen … ]                              ▾
──────────────────────────────────────────────────
  OBST & GEMÜSE                            (4)

  [ ]  Tomaten                       1,5 kg
       ▸ aus Rezept „Pasta“
  [ ]  Gurke                          1 Stk
  [ ]  Zwiebeln                       2 Stk
  [ ]  Kartoffeln                     1 kg

  MILCH & EIER                             (2)

  [ ]  Milch                          2 l
  [ ]  Eier                          10 Stk

  ▾ ERLEDIGT (3)

  [x]  Brot                       ~~1 Stk~~
  [x]  Butter                     ~~250 g~~
  [x]  Kaffee                     ~~500 g~~

──────────────────────────────────────────────────
  [        Artikel hinzufügen …        ]    [+]
──────────────────────────────────────────────────
    Liste            Rezepte            Mehr
══════════════════════════════════════════════════
  ↑ Linke Checkbox-Fläche = Abhaken (1 Tap)
  ↑ [+] oder Tap ins Feld = Hinzufügen (1–2 Taps)
```

### Beschriftete Kerninteraktionen

| # | Interaktion | Taps | Ablauf |
|---|---|---|---|
| **A1** | **Hinzufügen** (≤ 2 Taps) | **1–2** | Tap in die Add-Zeile (1) → tippen → Enter/„+“ (2). Feld bleibt fokussiert für die nächste Eingabe. Sonderfall: „+“ mit leerem Feld übernimmt einen Vorschlag aus der Historie (dann 1 Tap). |
| **A2** | **Abhaken** | **1** | Tap auf die Checkbox-Fläche links in der Zeile → `checked = true`, Zeile wandert animiert nach „Erledigt“; Outbox-Eintrag wird sofort geschrieben. Erneuter Tap macht es rückgängig. |
| **A3** | Bearbeiten (Menge/Einheit/Name) | 2 | Tap auf den Zeilentext → Bottom-Sheet mit Name, Menge, Einheit, Kategorie, Notiz → „Speichern“. |
| **A4** | Löschen mit Undo | 2 | Swipe nach links (oder ⋮ → Löschen) → Soft-Delete + Toast „Gelöscht – Rückgängig“ (5 s). Kein Bestätigungsdialog. |
| **A5** | Kategorie ändern (Lernregel) | 3 | Bearbeiten-Sheet → Kategorie wählen → Speichern. Schreibt eine Haushalts-`category_rule` (PLAN §4.4). |
| **A6** | Sync-Status prüfen | 0–1 | Chip in der Kopfzeile; Tap öffnet Outbox-Details (ausstehende Einträge, Retry). |

### Zustände

```text
Leer:          „Noch nichts auf der Liste.“
               [ Ersten Artikel hinzufügen ]  → fokussiert die Add-Zeile
Offline:       Chip „offline · 3 ausstehend“; Hinzufügen/Abhaken bleibt voll
               funktionsfähig (Schreiben nach Dexie + Outbox).
Sync-Fehler:   Chip „2 nicht synchronisiert“; Tap → Liste der Einträge mit
               „Erneut versuchen“ (Dead-Letter erst nach N Versuchen, T4.3).
Duplikat:      Beim Hinzufügen gleicher name_normalized + gleiche Dimension:
               „Tomaten sind schon drauf. Menge addieren? 1,5 kg + 0,5 kg = 2 kg“
               [Addieren] [Eigene Zeile] — Default „Addieren“ (PLAN §4.3, A-8).
```

---

## 2. Skizze B — Rezept (Detail + Portionsrechner)

Zweck: Zutaten lesen, Portionen anpassen, Zutaten auf die Liste übertragen. Einstieg
über Tab „Rezepte“ → Rezeptliste → Rezept.

```text
══════════════════════════════════════════════════
  ←  Rezepte                     [sync: ok]    ⋮
──────────────────────────────────────────────────
  Pasta mit Tomatensauce             [Bearb.]
  #vegetarisch #italienisch

  Portionen:      [ − ]    4    [ + ]
  (Basis: 4)       Zutaten skaliert ×1,0
──────────────────────────────────────────────────
  ZUTATEN (6)

  [ ]  Spaghetti                      400 g
  [ ]  Passierte Tomaten              800 g
  [ ]  Zwiebeln                        2 Stk
  [ ]  Knoblauch                       2 Zehe
  [ ]  Olivenöl                        2 EL
  [ ]  Basilikum                       1 Bund

  ZUBEREITUNG                          ▾
  1. Zwiebeln würfeln, anbraten …
  2. Tomaten zugeben, 20 min köcheln …

──────────────────────────────────────────────────
         [ Auf die Einkaufsliste ]
══════════════════════════════════════════════════
  ↑ „habe ich“-Haken links = Zutat nicht übernehmen
  ↑ Portions-Buttons sind 44 × 44 px
```

### Beschriftete Kerninteraktionen

| # | Interaktion | Taps | Ablauf |
|---|---|---|---|
| **B1** | Portionen ändern | 1 | „+“/„−“ skaliert alle Zutaten live (sinnvolle Rundung, z. B. ½ TL). Kein Speichern nötig; das Rezept selbst bleibt unverändert. |
| **B2** | Zutat „habe ich“ markieren | 1 | Tap auf die Checkbox → Zutat wird beim Übertragen standardmäßig **nicht** übernommen (optional; Vorratsliste T3.5). |
| **B3** | **Auf die Liste** (Import-Vorschau) | **2** | Tap auf den CTA → Import-Vorschau (Skizze C) öffnet sich; Bestätigen dort = 2. Tap. |
| **B4** | Rezept bearbeiten | 2 | „Bearbeiten“ → Formular (Titel, Portionen, Zutaten, Tags) → „Speichern“. Offline über Dexie/Outbox. |
| **B5** | Zutat antippen | 2 | Zeile antippen → Sheet „Menge/Einheit ändern“ → „Speichern“ (nur für dieses Rezept). |

---

## 3. Skizze C — Import-Vorschau (aus Rezept „Auf die Liste“)

Zweck: vor dem Schreiben zeigen, was passiert — inkl. Mengen-Addition und nicht
konvertierbarer Einheiten. Entspricht T3.4 / A-8.

```text
══════════════════════════════════════════════════
   Auf die Liste               (×) schließen
──────────────────────────────────────────────────
   Rezept: Pasta mit Tomatensauce
   Portionen: 4  →  Einkauf für 4 Personen

   [x] Alle auswählen          [Alle] [Keine]
──────────────────────────────────────────────────
   [x] Spaghetti           400 g  →  400 g
   [x] Passierte Tomaten   800 g  →  800 g
   [x] Zwiebeln              2 Stk →  2 Stk
   [ ] Knoblauch             2 Zehe (habe ich)
   [x] Olivenöl              2 EL  →  2 EL
   [x] Basilikum             1 Bund → 1 Bund

   -- Hinweise ----------------------------------
   ! Tomaten liegen schon auf der Liste:
     1,5 kg + 0,8 kg = 2,3 kg    [Addieren]
   ! „1 Prise Salz“ nicht konvertierbar →
     eigene Zeile (Unbestimmt)
──────────────────────────────────────────────────
    [ Abbrechen ]    [ 4 Artikel übernehmen ]
══════════════════════════════════════════════════
   ↑ Sheet von unten; Schließen = keine Schreibaktion
```

### Beschriftete Kerninteraktionen

| # | Interaktion | Taps | Ablauf |
|---|---|---|---|
| **C1** | **Import-Vorschau** öffnen | 1 | Aus Skizze B (B3) bzw. aus der Rezeptliste „Auf die Liste“ → Sheet erscheint mit allen Zutaten, Mengen und Hinweisen. |
| **C2** | Zutat ab-/auswählen | 1 je Zutat | Checkbox in der Vorschau; „Alle“/„Keine“ als Sammelaktion. |
| **C3** | Konflikt entscheiden | 1 | Bei gleichem Namen + gleicher Dimension: Default „Addieren“ (RPC `add_to_list`); „Eigene Zeile“ als Alternative. |
| **C4** | Import bestätigen | 1 | Primär-CTA → RPC `add_to_list` je Zutat, `source_recipe_id` gesetzt; Sheet schließt, Liste zeigt Sync-Chip und Toast „4 Artikel hinzugefügt“. |
| **C5** | Import abbrechen | 1 | „Abbrechen“ oder „×“ → keine Schreibaktion. |

---

## 4. Tap-Bilanz der Kernpfade (Prüf-Ebene für Human Gate 1)

| Kernpfad | Start | Taps bis Ziel | Anmerkung |
|---|---|---|---|
| Artikel hinzufügen (manuell) | Listenansicht | **≤ 2** | Tap ins Feld → Eingabe → Enter/„+“; Feld bleibt offen |
| Artikel abhaken | Listenansicht | **1** | Checkbox-Fläche in der Zeile |
| Abhaken rückgängig | Listenansicht | **1** | erneuter Tap |
| Rezept → Import-Vorschau | Rezeptdetail | **2** | CTA „Auf die Liste“ (1) + Vorschau ist der 2. Schritt |
| Import bestätigen | Import-Vorschau | **1** | Primär-CTA |
| Löschen (mit Undo) | Listenansicht | **2** | Swipe + „Rückgängig“ (optional) |

## 5. Offene Punkte für Human Gate 1 (PO-Entscheid)

1. **Add-Zeile:** Immer sichtbar (fixiert) vs. nur am Scroll-Ende? *Empfehlung:* immer sichtbar.
2. **Abhaken-Geste:** Checkbox-Tap vs. Swipe rechts? *Empfehlung:* Checkbox als Primärgeste, Swipe optional zusätzlich.
3. **Erledigt-Sektion:** standardmäßig ein- oder ausgeklappt? *Empfehlung:* eingeklappt, Zähler sichtbar.
4. **Import-Default bei Duplikaten:** „Addieren“ vorausgewählt? *Empfehlung:* ja, mit sichtbarer Rechnung.
5. **Rezept-Checkbox:** „habe ich“-Markierung schon in v1 sichtbar? *Empfehlung:* ja, aber ohne Vorratslisten-Verwaltung (T3.5 bleibt optional).
