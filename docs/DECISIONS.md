# Entscheidungen

Format je Eintrag: Datum, Entscheidung, Begründung, Alternative, Risiko/Status.

## 2026-10-25 — HTTPS/TLS: Caddy Variante A (xcaddy + lego-deprecated)

- **Entscheidung:** Caddy wird als eigenes Image per `xcaddy build` mit
  `github.com/caddy-dns/lego-deprecated` gebaut; die DNS-01-Challenge läuft
  gegen ipv64.net (`tls { dns lego_deprecated ipv64 }`). Modulstand ist auf
  Commit `9187923c0cf983e9bc9db5fad5b6569994b190d6` gepinnt.
- **Begründung:** In `PLAN.md` §5 (T1.3) ist Variante A bevorzugt. DNS-01
  erlaubt gültige Zertifikate ohne öffentlich erreichbaren Port 80/443; der
  Betrieb kann auf LAN/VPN beschränkt bleiben. Ein einzelner Caddy-Container
  statt Caddy + lego + Cert-Volume reduziert bewegliche Teile.
- **Alternative:** Variante B — `lego`-Container erneuert per Cron
  (`--dns ipv64`) und Caddy bindet `/certs/fullchain.pem` + `key.pem` ein.
  Nur Fallback, falls der xcaddy-Build mit Caddy 2.11.7 bricht. Wechsel
  betrifft nur den Caddy-Service (Image/Caddyfile) plus lego-Service.
- **Risiko/Status:** `lego-deprecated` ist ein Übergangs-Shim ohne Releases
  (letzter Commit 2022); der Build ist in dieser Sandbox ohne Docker-Daemon
  nicht ausführbar. Verifikation auf Docker-Host offen. Offene Frage an PO:
  konkreter DNS-Name und Ziel-IP (öffentlich vs. privat).

## 2026-10-25 — T1.4/T1.5 lokal ohne `supabase`-CLI verifiziert (Vanilla PG 16.2 + pgTAP)

- **Entscheidung:** Die Migrationen, die RLS-Policies und der Seed werden in
  dieser Sandbox gegen eine **Vanilla-PostgreSQL-16.2**-Instanz plus
  Supabase-Kompatibilitäts-Shim (`auth`-Schema, `auth.uid()`, Rollen
  `anon`/`authenticated`/`service_role`) und **pgTAP als plain SQL**
  geprüft — nicht über `supabase db reset` / `supabase test db`.
- **Begründung:** In der Sandbox läuft kein Docker-Daemon und die
  `supabase`-CLI ist nicht installiert; `supabase db reset` / `test db`
  sind dort nicht ausführbar. Der Shim deckt genau die Flächen ab, die die
  Migrationen berühren (`auth.users`, `auth.uid()`, Rollen, Grants). Die
  Ersetzung ist damit aussagekräftig für RLS/Trigger/Seed-Verhalten.
- **Alternative:** Warten auf einen Docker-Host und dort `supabase db reset`
  + `supabase test db` laufen lassen. Der Shim bleibt als schnelle lokale
  Vorprüfung nützlich, weil er Sekunden statt Container-Starts braucht.
- **Risiko/Status:** Verifikation ist **grün**: Migration 001/002 und Seed
  laufen mit `ON_ERROR_STOP=1` fehlerfrei; pgTAP `01_rls.sql` meldet
  **45/45 ok, 0 Fehler**. Seed ist idempotent (zweiter Lauf: weiterhin
  13 globale Kategorien, 389 Keyword-Regeln, 13 `unit_enum`-Werte).
  Offen: Gegenprobe mit dem echten Supabase-Stack (`supabase db reset`,
  `supabase test db`) auf einem Docker-Host. Die Shim-Dateien liegen
  außerhalb des Repos unter
  `/opt/data/profiles/backend/cache/scratch/pg/` (`bootstrap.sql`,
  `pgtap_ready.sql`, `run_verify.sh`).
