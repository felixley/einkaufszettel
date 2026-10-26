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
  PASS: temporaeres Cluster gestartet (Port 59981)
  PASS: Quell-DB ez_src: Migrationen + Seed geladen
  PASS: backup.sh: Archiv erzeugt (einkaufszettel-20261026T130403Z.sql.gz, 19033 Byte)
  PASS: Metadaten-Sidecar vorhanden
  PASS: restore.sh: in ez_restored eingespielt
  PASS: add_to_list_requests count=0 md5=empty
  PASS: categories         count=13 md5=ca821b8d675b
  PASS: category_rules     count=389 md5=b0ab88d8450d
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
  PASS: Retention: Archiv aelter als 14 Tage geloescht
  PASS: Retention: aktuelles Archiv erhalten

==== ERGEBNIS: 29 bestanden, 0 fehlgeschlagen (Modus real) ====
EXIT=0
```

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
