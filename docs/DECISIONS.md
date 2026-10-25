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
  - `supabase test db` laufen lassen. Der Shim bleibt als schnelle lokale
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

## 2026-10-25 — Seed doppelt verdrahtet: Compose-Init + Supabase-CLI

- **Entscheidung:** `supabase/seed.sql` wird auf zwei Wegen eingespielt:
  1. Compose-Stack: Bind-Mount `./supabase/seed.sql` →
     `/docker-entrypoint-initdb.d/zz_seed.sql` (alphabetisch nach den
     Migrationen, nur beim ersten Start eines leeren `db-data`-Volumes).
  2. Supabase CLI: `supabase/config.toml` mit `project_id = "einkaufszettel"`
     und `[db.seed] enabled = true, sql_paths = ["./seed.sql"]` für
     `supabase db reset`.
- **Begründung:** Der Compose-Stack nutzt die Supabase CLI nicht; ohne den
  zusätzlichen Mount bliebe eine frische Datenbank leer (0 statt 13
  Kategorien). Umgekehrt braucht `supabase db reset` die Projektkonfiguration.
  Beide Pfade verwenden dieselbe idempotente Seed-Datei; ein zweiter Lauf
  erzeugt keine Duplikate (`ON CONFLICT DO NOTHING`).
- **Alternative:** Nur Compose-Mount (dann ist `supabase db reset` nicht
  lauffähig) oder nur CLI (dann startet der Compose-Stack ohne Basisdaten).
- **Risiko/Status:** Init-Skripte laufen nur bei leerem Datenvolume; nach
  Schema-/Seed-Änderungen ist `docker compose down -v` nötig (löscht
  Dev-Daten). Verifiziert in dieser Sandbox ohne Docker-Daemon:
  - `docker-compose config -q` (v5.6.1) exit 0; der gerenderte Seed-Mount
    erscheint als `source: .../supabase/seed.sql` →
    `target: /docker-entrypoint-initdb.d/zz_seed.sql`, `read_only: true`.
  - Portable PostgreSQL 18.4 + Supabase-Shim, Bootstrap + Migration 001/002 +
    Seed: `categories=13`, `category_rules=389`, `global_categories=13`;
    zweiter Seed-Lauf weiterhin 13/389 (idempotent).
  - Supabase CLI 2.122.0 parst `supabase/config.toml` und scheitert erst an
    der fehlenden Docker-Engine (`LocalDbRunningError`), nicht an der
    Konfiguration.
    Offen: Laufzeitnachweis `docker compose up` bzw. `supabase db reset` auf
    einem Docker-Host.

## 2026-10-25 — D3 erneut geprüft: Docker hier nicht installierbar (Capability-Block)

- **Entscheidung:** Der Docker-Laufzeitnachweis (T1.3/D3) wird in dieser
  Sandbox **nicht** erneut versucht. Die Aufgabe wird mit `kind=capability`
  blockiert; ein weiterer Retry in derselben Umgebung ist zwecklos.
- **Begründung (gemessen, nicht vermutet):** Der Docker-Client ist vorhanden
  (26.1.5+dfsg1, Compose v5.6.1), aber es gibt keinen erreichbaren Daemon:
  `/var/run/docker.sock` fehlt, `docker info` scheitert mit „Cannot connect
  to the Docker daemon“. Eine Installation ist ausgeschlossen: Ausführung als
  `uid=10000(hermes)`, kein `sudo`, `CapEff=0000000000000000`,
  `unshare -Ur` → `Operation not permitted` (User-Namespaces gesperrt),
  `/var/lib/dpkg` und `/usr/bin` nicht schreibbar. `apt-get install --dry-run`
  löst nur auf; ein echter Install scheitert an fehlenden Root-Rechten.
  Damit sind weder Docker-CE noch rootless Podman lauffähig.
- **Teilnachweise, die ohne Docker real erbracht wurden:**
  1. `docker compose config --quiet` → Exit 0 (Compose-Datei syntaktisch
     gültig, 5 Dienste, Seed-Mount korrekt).
  2. Caddy 2.11.7 (Stock-Binary) mit einer Test-Variante des Caddyfiles
     (`tls internal` statt `tls { dns lego_deprecated ipv64 }`, Ports
     8443/8080, `admin off`): `caddy validate` → „Valid configuration“,
     Start erfolgreich, Zertifikat von „Caddy Local Authority“ ausgestellt,
     `curl --resolve … https://…:8443/health` → **HTTP/2 200, Body `ok`**.
     Proxied Pfad `/rest/v1/` → **502** mit
     `dial tcp: lookup rest on 127.0.0.11:53: server misbehaving` — belegt,
     dass das Routing greift und nur die Docker-DNS-Auflösung fehlt.
  3. Portable PostgreSQL 18.6.1 (theseus-rs-Binaries) + Supabase-Shim
     (`auth`-Schema, `auth.users`, `auth.uid()`, Rollen
     `anon`/`authenticated`/`service_role`): Migrationen 001–003 und Seed
     liefen mit `ON_ERROR_STOP=1` fehlerfrei; `select count(*) from
public.categories` → **13**, `category_rules` → **389**; zweiter
     Seed-Lauf → `INSERT 0 0`, Count bleibt 13 (idempotent).
  4. Gegenprobe „echtes LE-Zertifikat“: mit den ipv64-Platzhalterwerten
     (`DOMAIN`, `IPV64_API_KEY`) nicht möglich. Das Caddyfile verlangt das
     DNS-Modul `dns.providers.lego_deprecated`, das nur der
     `xcaddy`-Build im `caddy/Dockerfile` liefert; das Stock-Binary meldet
     „module not registered“. DNS-01 gegen ipv64 ist daher erst mit echten
     Zugangsdaten und Domain auf einem Docker-Host testbar.
- **Alternative:** Laufzeitnachweis auf einem Host mit laufendem
  Docker-Daemon (oder CI-Runner mit `docker:dind`): `docker compose up -d
--build`, 5 Dienste `healthy`, `curl https://$DOMAIN/health` → `{"status":
"ok"}`, danach `supabase db reset` mit echtem Domain-/DNS-Setup.
- **Risiko/Status:** D3 bleibt **offen**; alle übrigen Teile sind lokal
  belegt. Risiko der Nichtprüfung: Build-Fehler im xcaddy-Image oder
  Compose-Startfehler (Volumes/Healthchecks) blieben bis zum Host-Lauf
  unentdeckt. Die Caddy-Konfiguration selbst ist validiert; der 502-Fall
  ist erwartet und kein Defekt. Shim/Testartefakte liegen außerhalb des
  Repos unter
  `/opt/data/profiles/devops/cache/scratch/d3/` (`prelude.sql`,
  `Caddyfile.start`, portable PG-Binaries).

## 2026-10-25 — T2.1 Auth: Adapter-Abstraktion, Mock fuer Dev/E2E, `proxy.ts` statt `middleware.ts`

- **Entscheidung:** `apps/web` bekommt eine duenne Auth-Abstraktion
  (`lib/auth/`): `AuthAdapter` mit zwei Implementierungen — `SupabaseAuthAdapter`
  (`@supabase/ssr`, Cookie-Session gegen die Compose-GoTrue) und
  `MockAuthAdapter` (localStorage-Nutzer, Session im nicht signierten Cookie
  `ez_mock_session`). Die Auswahl erfolgt ueber `NEXT_PUBLIC_AUTH_MOCK` bzw.
  automatisch, wenn `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` fehlen. Routenschutz
  liegt in `apps/web/proxy.ts` (Next.js 16 hat `middleware.ts` in `proxy.ts`
  umbenannt; Funktion heisst `proxy`).
- **Begruendung:** In dieser Sandbox laeuft kein Docker-Daemon, damit ist keine
  GoTrue-Instanz erreichbar. Der Mock erlaubt den geforderten E2E-Nachweis
  Register→Login→Logout offline und ohne Secrets. Der echte Adapter ist
  vollstaendig implementiert und wird aktiv, sobald die Env-Variablen gesetzt
  sind — kein Code-Umbau noetig.
- **Alternative:** E2E-Tests gegen eine echte, temporaere GoTrue-Instanz
  (docker compose) oder ein MSW-gemocktes Netzwerk. Verworfen, weil Docker hier
  fehlt und MSW zusaetzliche Abhaengigkeiten in den Produktions-Bundle-Pfad
  bringt.
- **Risiko/Status:** Der Mock ist **keine echte Authentifizierung**: Passwoerter
  liegen als SHA-256-Hash in `localStorage`, das Session-Cookie ist unsigniert
  und nur fuer Dev/E2E gedacht. In Produktion muss `NEXT_PUBLIC_AUTH_MOCK`
  ungesetzt/false sein und eine echte Supabase-URL konfiguriert werden. Das ist
  im `.env.example` und im Mock-Modul-Kommentar ausdruecklich vermerkt.
  Weiterhin: E2E-Basisport ist 3210 (3100 war in der Sandbox durch einen
  verwaisten `next-server` belegt); Browser-Pfad wird in
  `playwright.config.ts` auf `~/.cache/ms-playwright` korrigiert, falls
  `PLAYWRIGHT_BROWSERS_PATH` auf ein leeres Verzeichnis zeigt.

## 2026-10-25 — T2.3/T2.4: Invite-Token als Hash, zwei interne Definer-Helfer, RLS-Fix fuer Mitglieder

- **Entscheidung 1 — Token nur als Hash:** Der Client erzeugt den Einladungs-
  Token (>= 128 Bit Zufall) und ruft `create_invite` ausschliesslich mit dem
  **Hash** auf; der Roh-Token bleibt beim Client und wird fuer Link und QR
  (`qrcode`) verwendet. Der Server kennt den Roh-Token nie.
- **Entscheidung 2 — zwei interne SECURITY-DEFINER-Helfer:** Die Einloesung
  einer Einladung (`internal.accept_invite`) und das Verlassen eines Haushalts
  (`internal.leave_household`) koennen nicht ueber RLS abgebildet werden: der
  Eingeladene ist kein Owner (darf `invites`/`household_members` nicht
  schreiben) und Editor/Viewer duerfen ihre eigene Mitgliedszeile nicht selbst
  soft-loeschen (`household_members_update` ist Owner-only). Beide Helfer
  liegen im Schema `internal` (nicht per PostgREST exponiert), nehmen **nie**
  eine fremde User-ID entgegen (arbeiten mit `auth.uid()`) und implementieren
  die Tokenpruefung (Widerruf/Ablauf/Auslastung) bzw. die
  Letzter-Owner-Regel explizit. Alle anderen RPCs der Migration bleiben
  `SECURITY INVOKER`; pgTAP prueft fuer die oeffentlichen Funktionen
  `prosecdef = false`.
- **Begruendung:** Ohne diese Helfer waeren Invite-Einloesung und Austritt
  entweder unmoeglich oder nur durch eine RLS-Policy abbildbar, die einem
  Mitglied erlauben wuerde, seine eigene Rolle zu aendern
  (Privilegien-Eskalation Viewer->Owner). Alternative „alles SECURITY DEFINER"
  verwirft die RLS-Durchsetzung fuer die Mehrheit der Pfade; verworfen.
- **Entscheidung 3 — Letzter-Owner-Regel und `households.owner_id`:** Es bleibt
  immer mindestens ein aktiver Owner. Beim Verlassen/Entfernen/Herabstufen
  eines Owners wird `households.owner_id` auf einen verbleibenden aktiven Owner
  umgehaengt, sonst behielte der ausgeschiedene Nutzer ueber die
  `households_select`-Policy (`owner_id = auth.uid()`) weiterhin Einblick in
  den Haushalt, obwohl seine Mitgliedschaft entfernt wurde.
- **Entscheidung 4 — RLS-Fix 006:** `household_members_select` erlaubt Ownern
  den Blick auf soft-geloeschte Mitgliedszeilen. Grund: PostgreSQL wendet die
  USING-Klausel der SELECT-Policy bei `UPDATE` zusaetzlich auf die NEUE Zeile
  an; mit `deleted_at IS NULL` scheiterte jedes `remove_member` an „new row
  violates row-level security policy". Identischer Mechanismus wie beim
  `lists`-Fix in Migration 004; Editor/Viewer sehen weiterhin nur aktive
  Mitglieder, Nichtmitglieder nichts.
- **Entscheidung 5 — Fehler-Transparenz bei Einladungen:** unbekannter Token
  `P0002` („nicht gefunden"), abgelaufen/widerrufen/aufgebraucht `22023` mit
  jeweils eigener Meldung. Der AK „abgelaufener Link wird abgelehnt" verlangt
  eine unterscheidbare Meldung; der Besitzer des Tokens kennt das Geheimnis
  ohnehin, ein Existenz-Orakel ist damit nicht verbunden. Fuer das Widerrufen
  durch Nicht-Owner bleibt es bei der Konvention aus Migration 003 („keine
  Berechtigung" und „nicht gefunden" teilen denselben Fehler, kein Orakel).
- **Risiko/Status:** Belegt durch pgTAP-Suite `03_invites_and_members.sql`
  (77/77) und den Gesamtlauf 184/184 (`docs/TESTLOG-T2.3-T2.4.md`).
  Das Frontend erzeugt Token, Link und QR clientseitig; fuer die
  Rate-Limiting-Anforderung aus PLAN.md §4.5 bleibt Caddy zustaendig (T1.3).
