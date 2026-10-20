# PLAN — Einkaufszettel

Projekt: Einkaufszettel (Supabase/PostgreSQL + Next.js/PWA, Docker-Homeserver).

> Diese Datei wird vom Profil **architect** gepflegt. Jede Aufgabe bekommt hier ein
> klares Akzeptanzkriterium, bevor sie an ein anderes Profil delegiert wird.

## 1. Ziel
Einkaufszettel-App: Einkäufe am Handy erfassen, lokal (Dexie) halten und mit Supabase synchronisieren.

## 2. Architektur
- `packages/core` — reine Logik (Einheiten, Aggregation, Kategorisierung, Sync), deterministisch, testgetrieben.
- `apps/web` — Next.js + TypeScript strict + Tailwind, liest nur aus Dexie, schreibt über `packages/core`.
- `supabase/migrations` — Datenbank, ausschließlich per Migration, UUIDv7-IDs vom Client, Soft-Deletes, `updated_at`-Trigger.
- `docs/` — HANDOFF.md (Aufträge), BACKLOG.md (Scope-Erweiterungen), REVIEW.md (QA-Befunde).

## 3. Akzeptanzkriterien
Noch nicht definiert — vom architect zu ergänzen.

## 4. DB-Schema-Konventionen
- Primärschlüssel: UUIDv7, **vom Client** erzeugt.
- Soft-Deletes statt `DELETE`.
- `updated_at`-Trigger auf allen Tabellen.
- Jede Tabelle mit Row Level Security; jede Policy mit pgTAP-Test.

## 5. Rollen
| Profil | Zuständigkeit | Grenze |
|---|---|---|
| architect | Plan, Entscheidung, Übergabe | kein Produktivcode |
| backend | DB, Migrationen, RLS, pgTAP | kein Frontend, kein `packages/core` |
| core | reine Logik, Tests | nur `packages/core` |
| frontend | UI, Dexie, Sync-Anbindung | nur `apps/web` |
| devops | Compose, Skripte, Backups, CI | kein Anwendungscode |
| qa | Tests, Reviews, Urteil | kein Produktivcode |
