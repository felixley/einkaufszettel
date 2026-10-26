# BACKLOG

Out-of-Scope für v1 gemäß `PLAN.md` §1. Nichts hiervon wird in Welle 1 umgesetzt.
Aufnahme nur nach Entscheidung des Product Owners.

| Thema                                             | Herkunft                                       | Begründung                                                                                 | Status                               |
| ------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| Social-Login                                      | PLAN.md §1 Out of Scope                        | E-Mail-Login deckt v1 ab; OAuth erhöht Auth- und RLS-Komplexität                           | zurückgestellt                       |
| Rezeptimport per URL                              | PLAN.md §1 Out of Scope                        | Parser/Scraper unzuverlässig, rechtliche Fragen; manuelle Rezepte reichen für v1           | zurückgestellt                       |
| Barcode-Scan                                      | PLAN.md §1 Out of Scope                        | Kein MVP-Beitrag, zusätzliche Kamera-/Geräte-Abhängigkeit                                  | zurückgestellt                       |
| Push-Benachrichtigungen                           | PLAN.md §1 Out of Scope                        | Service-Worker-Push erst nach stabiler Offline-/Sync-Schicht sinnvoll                      | zurückgestellt                       |
| KI-Kategorisierung                                | PLAN.md §1 Out of Scope                        | Regelbasierte Kategorisierung (T2.7) ist ausreichend und erklärbar                         | zurückgestellt                       |
| Native Apps                                       | PLAN.md §1 Out of Scope                        | PWA deckt den Anwendungsfall ab                                                            | zurückgestellt                       |
| Preisvergleich                                    | PLAN.md §1 Out of Scope                        | Kein MVP-Beitrag; Datenmodell würde verbreitert                                            | zurückgestellt                       |
| Vorratsliste „Zutaten, die ich schon habe“ (T3.5) | PLAN.md §5 Phase 3 („nur wenn Aufwand <1 Tag“) | Eigene Tabelle + RLS + CRUD + Abgleichlogik = deutlich >1 Tag; Welle 3 bewusst ausgelassen | zurückgestellt (Welle 3, 2026-10-26) |
