# Testlog T5.4 — Betrieb: Backup, getesteter Restore, Update, Healthchecks, Logrotation, Monitoring

Datum: 2026-10-26 · Umgebung: Linux, **kein Docker-Daemon**, kein `psql` im
PATH, aber portables **PostgreSQL 18.6.1** (theseus-rs-Binaries) verfügbar und
`docker compose` (Plugin) ohne Daemon lauffähig.

Alle Ausgaben unten sind echte Terminal-Ausgaben dieser Welle.

---

## 1. Syntaxprüfung der Skripte

```text
$ for f in scripts/backup.sh scripts/restore.sh scripts/test-restore.sh scripts/check-cert-expiry.sh; do bash -n "$f" && echo "OK $f"; done
OK scripts/backup.sh
OK scripts/restore.sh
OK scripts/test-restore.sh
OK scripts/check-cert-expiry.sh
```

## 2. Restore-Test — Modus `real` (End-to-End gegen portables PostgreSQL)

```text
$ PG_BIN=.../postgresql-18.6.1-.../bin bash scripts/test-restore.sh --mode real
== Statische Pruefungen ==
  PASS: bash -n: backup.sh
  PASS: bash -n: restore.sh
  PASS: bash -n: check-cert-expiry.sh
  PASS: backup.sh ausfuehrbar
  PASS: restore.sh ausfuehrbar
== Negativ-Tests: restore.sh verweigert unsichere Aufrufe ==
  PASS: fehlende Bestaetigung -> Exit 3
  PASS: fehlende Datei -> Exit 2
  PASS: fehlendes TARGET_DB -> Exit 2
  PASS: beschaedigtes Archiv -> Exit 4
== Modus real (PostgreSQL aus: /opt/data/profiles/devops/cache/scratch/d3/pg/postgresql-18.6.1-x86_64-unknown-linux-gnu/bin) ==
  PASS: temporaeres Cluster gestartet (Port 60327)
  PASS: Quell-DB ez_src: Migrationen + Seed geladen
  PASS: backup.sh: Archiv erzeugt (einkaufszettel-20261026T132033Z.sql.gz, 19033 Byte)
  PASS: Metadaten-Sidecar vorhanden
  PASS: restore.sh: in ez_restored eingespielt
  PASS: add_to_list_requests count=0 md5=empty
  PASS: categories         count=13 md5=560784a3e0b3
  PASS: category_rules     count=389 md5=e6a8c018475b
  PASS: household_members  count=0 md5=empty
  PASS: households         count=0 md5=empty
  PASS: invites            count=0 md5=empty
  PASS: list_items         count=0 md5=empty
  PASS: lists              count=0 md5=empty
  PASS: profiles           count=0 md5=empty
  PASS: recipe_ingredients count=0 md5=empty
  PASS: recipes            count=0 md5=empty
  PASS: alle Tabellen: count UND md5 identisch (vollstaendig, bit-genau)
  PASS: Ueberschreibschutz: nicht-leeres Ziel ohne RESTORE_DROP_EXISTING abgelehnt (Exit 5)
  PASS: Regression: Restore nach 'postgres' (leer, ohne Drop) erfolgreich
  PASS: Regression: TARGET_DB=postgres mit Drop/Create ueber Maintenance-DB erfolgreich
  PASS: Regression: 'postgres' enthaelt nach Restore 11 public-Tabellen
  PASS: DATABASE_URL: Restore nach TARGET_DB != URL-Pfad erfolgreich
  PASS: DATABASE_URL: Zieldaten in TARGET_DB 'ez_url_target' (11 Tabellen)
  PASS: DATABASE_URL: URL-Pfad-DB 'ez_urlpath' blieb unberuehrt (0 Tabellen)
  PASS: DATABASE_URL: DR-Pfad (Ziel=URL-Pfad, nicht leer, DROP_EXISTING) exit 0
  PASS: DATABASE_URL: DR-Ziel 'ez_url_dr' enthaelt nach Restore 11 Tabellen (Live-DB erhalten)
  PASS: Retention: Archiv aelter als 14 Tage geloescht
  PASS: Retention: aktuelles Archiv erhalten

==== ERGEBNIS: 37 bestanden, 0 fehlgeschlagen (Modus real) ====
EXIT=0
```

> Die MD5-Werte hängen vom jeweils aktuellen `supabase/seed.sql` ab und können
> sich mit parallel laufenden Seed-Änderungen verschieben; entscheidend ist,
> dass Quelle und Restore **identisch** sind.

**Was das belegt:**

- **Vollständigkeit bit-genau:** Zeilenzahl **und** MD5 je public-Tabelle in
  Quelle (`ez_src`) und Wiederherstellung (`ez_restored`) identisch. Die
  Migrationen 001–008 + Seed wurden zuvor fehlerfrei in die Quell-DB geladen
  (13 Kategorien, 389 Keyword-Regeln).
- **Kein destruktives Default:** `restore.sh` bricht ohne `RESTORE_CONFIRM`
  (Exit 3), ohne `TARGET_DB` (Exit 2), bei fehlender Datei (Exit 2) und bei
  beschädigtem Archiv (Exit 4) ab.
- **Überschreibschutz:** nicht-leeres Ziel ohne `RESTORE_DROP_EXISTING=yes`
  → Exit 5.
- **Retention:** ein künstlich auf 30 Tage zurückdatiertes Archiv wird bei
  `RETENTION_DAYS=14` gelöscht, das frische bleibt erhalten.
- **Metadaten:** Sidecar `.meta` mit SHA-256 wird erzeugt.

## 2b. Fix Review-Runde 1 — `TARGET_DB=postgres` / separate Maintenance-DB

**Befund:** Der DR-Pfad in `OPERATIONS.md` §5.2 verlangt `TARGET_DB=postgres`
(Compose-Default `POSTGRES_DB`). `dropdb`/`createdb` verbanden sich dabei
implizit mit `postgres` selbst → `cannot drop the currently open database`,
das folgende `createdb` scheiterte an „already exists".

**Fix:** `restore.sh` nutzt für Verwerfen/Anlegen eine **separate Maintenance-DB**
(`MAINT_DB`, Default `template1`, weicht bei Kollision auf `postgres` aus) und
übergibt sie als `--maintenance-db`; `postgres` ist nicht mehr als Ziel
verboten. `test-restore.sh --mode real` deckt den Fall als Regression ab.

**Minimalrepro (echtes PostgreSQL 18.6.1, temporäres Cluster):**

```text
### OHNE separate Maintenance-DB (wie vor dem Fix) ###
  dropdb: error: database removal failed: ERROR:  cannot drop the currently open database
  dropdb_exit=1
### MIT --maintenance-db template1 (Fix) ###
  dropdb_exit=0
  createdb_exit=0
  demo_target wieder da: OK
```

**Vorher/Nachher gegen den echten Skript-Stand:**

```text
Archiv: einkaufszettel-20261026T132048Z.sql.gz

### VORHER: alter Stand 4900666, TARGET_DB=postgres (Drop/Create) ###
  2026-10-26T13:20:48Z [restore] FEHLER: 'postgres' ist keine zulaessige Zieldatenbank.
  -> Exit-Code VORHER: 2

### NACHHER: gefixter Stand, TARGET_DB=postgres (Drop/Create) ###
  2026-10-26T13:20:48Z [restore] Verbindungsmodus: local  ->  Ziel 'postgres'
  2026-10-26T13:20:48Z [restore] Restore abgeschlossen: 'postgres' (1 Tabellen in public).
  -> Exit-Code NACHHER: 0
```

Im `--mode real`-Lauf oben erzwingt die zweite Regression den Drop/Create-Pfad
(nicht-leeres `postgres`) und belegt 11 wiederhergestellte public-Tabellen.

## 2c. Fix Review-Runde 2 — `DATABASE_URL`-Modus (`restore.sh`)

**Befunde (vom Reviewer reproduziert):**

1. Im Drop-Pfad stand `createdb` **außerhalb** des `DATABASE_URL`-Zweigs und lief
   über die libpq-Umgebungsvariablen. War die URL die **einzige** Verbindungsangabe
   (Ziel = URL-Pfad, nicht leer, `RESTORE_DROP_EXISTING=yes` — der §5.2-DR-Pfad),
   wurde das Ziel **erst gedroppt** und `createdb` scheiterte danach → Live-DB weg,
   `exit 1` (undokumentiert).
2. `psql_target` benutzte die **unveränderte** `DATABASE_URL` und ignorierte
   `TARGET_DB`: Bei abweichendem URL-Pfad wurde still in die URL-Datenbank
   geschrieben, während Log/Exit-Code Erfolg für `TARGET_DB` meldeten.

**Fix:** `DATABASE_URL` liefert nur noch **Host/Port/User**. Für Ziel-Operationen
wird der DB-Name im URL-Pfad durch `TARGET_DB` (bzw. `MAINT_DB` für Drop/Create)
ersetzt (`url_set_db`); ein abweichender URL-Pfad wird geloggt. Drop/Create laufen
im URL-Modus über (umgeschriebene) `psql`-Aufrufe gegen die Maintenance-URL — nie
über die Env. Vorbereitungsfehler enden jetzt mit Exit `6`.

**Vorher/Nachher am echten Skript (portables PostgreSQL 18.6.1, je temporäres
Cluster, `env -u PGHOST -u PGPORT -u PGUSER` → URL ist einzige Verbindungsangabe):**

```text
=== Blocker 1: Ziel = URL-Pfad, nicht leer, DROP_EXISTING=yes ===
VORHER : exit=1   — createdb: error: connection to server on socket "/tmp/.s.PGSQL.5432" failed
         nachher: ez_live existiert=0   (Live-DB ist weg)
NACHHER: exit=0
         [restore] Ziel 'ez_live' wird verworfen (RESTORE_DROP_EXISTING=yes).
         [restore] Restore abgeschlossen: 'ez_live' (1 Tabellen in public).
         nachher: ez_live existiert=1   (Live-DB erhalten)

=== Blocker 2: URL-Pfad (postgres) != TARGET_DB (ez_target) ===
VORHER : exit=0 (falsch zufriedenstellend)
         ez_target public-Tabellen: 0     (Ziel leer)
         postgres  public-Tabellen: 1     (stiller Falschziel-Restore)
NACHHER: exit=0
         ez_target public-Tabellen: 1     (Daten im Ziel)
         postgres  public-Tabellen: 0     (URL-Pfad unberuehrt)
```

Beide Fälle sind jetzt als Regression in `test-restore.sh --mode real` verankert
(siehe Abschnitt 2, 5 neue PASS-Zeilen).

---

## 3. Restore-Test — Modi ohne PostgreSQL

```text
$ bash scripts/test-restore.sh --mode stub
==== ERGEBNIS: 9 bestanden, 0 fehlgeschlagen (Modus stub) ====

$ bash scripts/test-restore.sh --mode dry-run
  PASS: restore.sh DRY-RUN akzeptiert Archiv: einkaufszettel-20261025T112706Z.sql.gz
==== ERGEBNIS: 10 bestanden, 0 fehlgeschlagen (Modus dry-run) ====
```

Auf einem Host **ohne** PostgreSQL-Binaries fällt `--mode auto` auf `stub`
zurück; der volle Lauf ist dann ein offener Host-Nachweis (analog D14/T1.3).

## 4. Cert-Expiry-Check (`check-cert-expiry.sh`)

Selbstsignierte Zertifikate, real erzeugt und geprüft:

```text
$ bash scripts/check-cert-expiry.sh <cert_30d.pem>
OK: CN=einkaufszettel.example gueltig bis Nov 25 13:02:10 2026 GMT — noch 30 Tage (Schwelle 14).   # exit 0
$ bash scripts/check-cert-expiry.sh <cert_2d.pem>
WARN: CN=einkaufszettel.example laeuft am Oct 28 13:02:10 2026 GMT ab — nur noch 2 Tage (Schwelle 14).   # exit 1
$ bash scripts/check-cert-expiry.sh <nope.pem>
FEHLER: Datei nicht gefunden: .../nope.pem   # exit 2
$ bash scripts/check-cert-expiry.sh <cert_expired.pem>
ABGELAUFEN: CN=old.example ist am Feb  1 00:00:00 2020 GMT abgelaufen (seit 2459 Tagen).   # exit 3
$ openssl s_server -accept 8443 -cert cert_30d.pem -key k.pem -www &   # Live-Endpoint
$ bash scripts/check-cert-expiry.sh "127.0.0.1:8443"
OK: CN=einkaufszettel.example gueltig bis Nov 25 13:02:10 2026 GMT — noch 30 Tage (Schwelle 14).   # exit 0
$ CERT_HOST=127.0.0.1 CERT_PORT=8443 bash scripts/check-cert-expiry.sh
OK: CN=einkaufszettel.example gueltig bis Nov 25 13:02:10 2026 GMT — noch 30 Tage (Schwelle 14).   # exit 0
```

Damit sind alle vier Exit-Codes (0/1/2/3) sowie der Datei- und der
Live-Endpoint-Pfad real belegt.

## 5. Compose: Logging + optionales Monitoring (statischer Host-Nachweis)

```text
$ docker compose config -q
EXIT=0
$ docker compose config --services | sort
auth / caddy / db / rest / web
$ docker compose --profile monitoring config --services | sort
auth / caddy / db / rest / uptime-kuma / web
```

Gerendertes Logging je Dienst (aus `docker compose --profile monitoring config --format json`):

```text
services: ['auth', 'caddy', 'db', 'rest', 'uptime-kuma', 'web']
  auth         driver=json-file options={'max-file': '3', 'max-size': '10m'}
  caddy        driver=json-file options={'max-file': '3', 'max-size': '10m'}
  db           driver=json-file options={'max-file': '3', 'max-size': '10m'}
  rest         driver=json-file options={'max-file': '3', 'max-size': '10m'}
  uptime-kuma  driver=json-file options={'max-file': '3', 'max-size': '10m'}
  web          driver=json-file options={'max-file': '3', 'max-size': '10m'}
total services: 6
```

`docker compose config` arbeitet ohne Docker-Daemon und ist daher **hier**
belegt: Compose-Datei gültig, Logging bei **allen** Diensten, optionaler
Uptime-Kuma-Dienst nur mit Profil `monitoring`.

## 6. Offene Host-Nachweise

Nicht ausführbar ohne Docker-Daemon (auf dem Host nachzuholen):

1. `docker compose up -d --build` → 5 Dienste `healthy`.
2. `docker compose --profile monitoring up -d` → Uptime-Kuma erreichbar.
3. `curl -fsS "https://${DOMAIN}/health"` → `{"status":"ok"}`.
4. `test-restore.sh --mode real` gegen die **Compose-DB** (statt portables PG).
