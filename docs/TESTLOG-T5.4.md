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
  PASS: categories         count=13 md5=7aade0b5cc2e
  PASS: category_rules     count=389 md5=bac52a87da11
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
  PASS: Retention: Archiv aelter als 14 Tage geloescht
  PASS: Retention: aktuelles Archiv erhalten

==== ERGEBNIS: 32 bestanden, 0 fehlgeschlagen (Modus real) ====
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
implizit mit `postgres` selbst → ``cannot drop the currently open database``,
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
