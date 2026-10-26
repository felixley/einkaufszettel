# Betriebshandbuch (T5.4)

Geltungsbereich: Compose-Stack `einkaufszettel` (self-hosted Supabase + Next.js

- Caddy) auf einem Docker-Host im Heimnetz. Dieses Dokument beschreibt
  Update-Prozedur, Healthchecks, Logrotation, Backup/Restore, Restore-Test,
  Monitoring und den Umgang mit dem Zertifikatsablauf.

Maßgeblich bleibt [`PLAN.md`](../PLAN.md); Architektur in
[`docs/ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 1. Image-Tags und Update-Prozedur

### 1.1 Gepinnte Versionen

Alle Images sind im `docker-compose.yml` auf feste Tags gepinnt (kein
`latest`):

| Dienst        | Image-Tag                                                    |
| ------------- | ------------------------------------------------------------ |
| `db`          | `supabase/postgres:15.19.0.007`                              |
| `auth`        | `supabase/gotrue:v2.197.0`                                   |
| `rest`        | `postgrest/postgrest:v16.5`                                  |
| `web`         | lokaler Build (`apps/web`)                                   |
| `caddy`       | lokaler Build (`caddy/`)                                     |
| `uptime-kuma` | `louislam/uptime-kuma:2.5.7` (optional, Profil `monitoring`) |

Ein Update ist damit ein bewusster Tag-Wechsel im Compose-File, kein
stilles `pull` eines gleitenden Tags.

### 1.2 Update-Schritte (Wartungsfenster)

Empfohlenes Fenster: werktags 03:00–05:00 lokal, wenn niemand einkauft. Für ein
Haushalts-Setup genügt ein kurzes, angekündigtes Fenster.

```bash
cd /opt/einkaufszettel

# 0) IMMER zuerst ein Backup + ein frischer Restore-Test.
bash scripts/backup.sh
bash scripts/test-restore.sh --mode auto

# 1) Neue Version bewusst setzen: in docker-compose.yml den Tag anpassen
#    (z. B. supabase/gotrue:v2.197.0 -> v2.19x.y) und committen.
git add docker-compose.yml
git commit -m "chore(deploy): <dienst> auf <neuer Tag>"
UPDATE_COMMIT="$(git rev-parse HEAD)"   # SHA fuer den Rollback notieren!

# 2) Images ziehen und Stack neu starten.
docker compose pull
docker compose up -d

# 3) Health abwarten und pruefen.
docker compose ps                 # alle Dienste (healthy)
curl -fsS "https://${DOMAIN}/health"   # {"status":"ok"}

# 4) Logs auf Fehler sichten.
docker compose logs --since 5m auth rest web caddy
```

### 1.3 Migrationen

DB-Migrationen (`supabase/migrations/*.sql`) und Seed laufen **nur beim ersten
Start auf einem leeren Datenvolume** (`/docker-entrypoint-initdb.d`). Ein
Image-Update spielt **keine** neuen Migrationen automatisch ein.

- **Neue Migration nötig?** Diese werden kontrolliert und separat eingespielt
  (in dieser Projektphase über die Supabase CLI bzw. `psql -f`), nachdem ein
  Backup existiert. Kein automatischer Migrationslauf im Update-Schritt.
- **Rollback-Strategie:** Ein Image-Rollback (früheren Tag zurücknehmen und
  `docker compose up -d`) ist nur zulässig, solange **keine** neue Migration
  eingespielt wurde. Sobald das Schema vorwärts migriert wurde, ist der
  Rückweg der **Restore des Vor-Update-Backups** (Abschnitt 5). Deshalb steht
  Schritt 0 vor jedem Update.

### 1.4 Rollback

Der `UPDATE_COMMIT` aus §1.2 Schritt 1 ist die Referenz. `git checkout --
docker-compose.yml` wäre nach dem Commit ein **No-op** (HEAD zeigt bereits auf
den neuen Tag) — deshalb wird der Commit zurückgenommen:

```bash
# Schema unveraendert: Images auf den Stand VOR dem Update zuruecknehmen.

# Variante A (empfohlen, sauberer Verlauf): Update-Commit rueckgaengig machen.
git revert --no-edit "${UPDATE_COMMIT:?SHA des Update-Commits aus 1.2}"
docker compose pull && docker compose up -d

# Variante B (falls kein Revert moeglich): Compose-File aus dem Vorgaenger-Commit.
git checkout "${UPDATE_COMMIT}^" -- docker-compose.yml   # ^ = Parent (Stand davor)
docker compose pull && docker compose up -d

# Schema vorwaerts migriert: Backup zurueckspielen (siehe Abschnitt 5).
```

Verifikation nach dem Rollback (je nach Variante — die Referenz unterscheidet
sich!):

- **Variante A (Revert-Commit):** `HEAD` zeigt jetzt auf den Revert →
  `git show HEAD:docker-compose.yml | grep -n 'image:'` zeigt wieder die alten
  Tags.
- **Variante B (Checkout ohne Commit):** `HEAD` bleibt unverändert → hier den
  Worktree-Stand prüfen: `git diff --cached -- docker-compose.yml` bzw.
  `grep -n 'image:' docker-compose.yml` (der Checkout staged die alten Tags).

In beiden Fällen danach: `docker compose ps` alle Dienste `healthy`;
`curl -fsS "https://${DOMAIN}/health"` liefert `{"status":"ok"}`.

---

## 2. Healthchecks und `/health`

Jeder Dienst hat im Compose-File einen Healthcheck; der Start wird über
`depends_on: condition: service_healthy` geordnet.

| Dienst  | Healthcheck (`test`)                           | interval | timeout | retries | start_period |
| ------- | ---------------------------------------------- | -------- | ------- | ------- | ------------ |
| `db`    | `pg_isready -U postgres -d $POSTGRES_DB`       | 10s      | 5s      | 10      | 20s          |
| `auth`  | `wget -qO- http://127.0.0.1:9999/health`       | 15s      | 5s      | 10      | 20s          |
| `rest`  | `wget -qO- http://127.0.0.1:3000/`             | 15s      | 5s      | 10      | 20s          |
| `web`   | `wget -qO- http://127.0.0.1:3000/health`       | 15s      | 5s      | 10      | 30s          |
| `caddy` | `caddy validate --config /etc/caddy/Caddyfile` | 30s      | 10s     | 3       | 10s          |

Die `start_period`-Werte decken die Kaltstart-Zeit ab (db-Init + Seed dauert
am längsten), ohne den Start unnötig zu verzögern. Die Intervalle sind
bewusst zurückhaltend (10–30 s), damit ein Heimserver nicht durch
Healthcheck-Last belastet wird.

**Externes Health-Signal:** `web` stellt `/health` bereit; Caddy proxied es
nach außen. Der Endpoint liefert `{"status":"ok"}` und ist der primäre
Monitoring-Check (Abschnitt 8).

```bash
docker compose ps
curl -fsS "https://${DOMAIN}/health"
```

---

## 3. Logrotation

Alle Dienste nutzen im Compose-File den Log-Treiber `json-file` mit Rotation
(YAML-Anker `x-logging`):

```yaml
logging:
  driver: json-file
  options:
    max-size: '10m'
    max-file: '3'
```

Damit ist jede Logdatei auf 10 MB begrenzt, es werden 3 Dateien vorgehalten
(**max. ~30 MB pro Dienst**). Ohne diese Grenze würden die Docker-Logs auf dem
Heimserver unbegrenzt wachsen.

- Gesamtgröße prüfen: `sudo du -sh /var/lib/docker/containers/*/*-json.log`
- Logs ansehen: `docker compose logs -f web`
- Rotation greift automatisch je Dienst — keine host-seitige `logrotate`-Regel
  für Container-Logs nötig.

**Ausnahme Caddy:** Caddy rotiert seine Logs selbst nur, wenn im Caddyfile
`log` konfiguriert ist; im aktuellen Setup wird kein Dateilog geschrieben,
sodass nur stdout/stderr über `json-file` laufen.

---

## 4. Backup

`scripts/backup.sh` erzeugt ein `pg_dump`-Archiv als `.sql.gz`.

- **Quelle:** lokale libpq (`DATABASE_URL` oder `PGHOST/PGPORT/...`) mit
  `pg_dump`, sonst Fallback `docker compose exec -T db pg_dump`.
- **Atomar:** Schreibt zuerst nach `.part`, prüft, dann `mv`.
- **Integritätsprüfung:** nicht-leer, `gzip -t` grün, PostgreSQL-Dump-Kopf
  vorhanden. Sonst Exit 1 und die `.part`-Datei wird verworfen.
- **Metadaten:** Sidecar `<name>.meta` mit Zeitstempel, Quelle, DB, Bytes und
  **SHA-256** des Archivs.
- **Retention:** löscht Archive + Metadaten älter als `RETENTION_DAYS`
  (Default **14**) — nur Dateien im eigenen Namensschema.

```bash
bash scripts/backup.sh                     # Standard, Retention 14 Tage
RETENTION_DAYS=30 BACKUP_DIR=/mnt/nas/backups bash scripts/backup.sh
DRY_RUN=1 bash scripts/backup.sh           # zeigt nur, was geloescht wuerde
```

Ablage: `backups/` (per `.gitignore` ausgeschlossen — **keine** Backups im
Repo). Cron: [`scripts/backup.cron.example`](../scripts/backup.cron.example).

**Empfehlung Offsite:** Zusätzlich `BACKUP_DIR` per `rsync`/`restic` auf ein
zweites Ziel (NAS, USB, verschlüsselte Cloud) spiegeln. Ein Backup auf
demselben Datenträger schützt nicht gegen Hardware-Ausfall.

---

## 5. Restore (Runbook)

> **Grundsatz:** Restore ist destruktiv und wird **immer zuerst in eine
> Scratch-Datenbank getestet**, bevor die Live-DB angefasst wird.

`scripts/restore.sh` verlangt:

- **`TARGET_DB`** — Zieldatenbank explizit, kein Default.
- **`RESTORE_CONFIRM=yes`** — explizite Bestätigung.
- **`RESTORE_DROP_EXISTING=yes`** — nur wenn ein **nicht-leeres** Ziel
  verworfen werden soll (sonst Abbruch).
- Vorprüfung: Datei vorhanden, `gzip -t`, PostgreSQL-Dump-Kopf.
- `psql -v ON_ERROR_STOP=1` — bricht beim ersten SQL-Fehler ab.

Für `drop`/`create` nutzt das Skript eine **separate Maintenance-DB**
(`MAINT_DB`, Default `template1`; weicht automatisch auf `postgres` aus, falls
die Wahl mit `TARGET_DB` kollidiert). Damit funktioniert auch ein Restore in die
Compose-Default-DB **`postgres`** (`POSTGRES_DB`): die Drop-/Create-Schritte
verbinden sich nicht mehr mit der Zieldatenbank selbst, was sonst mit `cannot
drop the currently open database` bzw. `being accessed by other users`
abbricht. Als Ziel sind nur `template0`/`template1` verboten.

**`DATABASE_URL` (libpq-URL):** Die URL liefert **nur Host/Port/User** — der
DB-Name im URL-Pfad ist für Ziel-Operationen **nicht** maßgeblich. `TARGET_DB`
bleibt die einzige verbindliche Zielangabe; das Skript ersetzt den Pfad der URL
intern durch `TARGET_DB` (bzw. `MAINT_DB` für Drop/Create). Weicht der URL-Pfad
von `TARGET_DB` ab, wird das im Log als Hinweis gemeldet, es wird aber **immer**
nach `TARGET_DB` geschrieben — kein stiller Falschziel-Restore. Der Modus ist
damit vollständig selbstständig: `drop`/`create`/Restore laufen alle über die
(umgeschriebene) URL und benötigen **keine** `PGHOST`/`PGPORT`-Umgebungsvariablen.

Exit-Codes: `0` Erfolg · `1` unerwarteter interner Fehler · `2` Argumente/Datei ·
`3` fehlende Bestätigung · `4` beschädigtes Archiv · `5` Ziel nicht leer ohne
Freigabe · `6` Verbindungsfehler / Ziel fehlt / Vorbereitung (Drop/Create)
fehlgeschlagen · `7` Restore-Fehler.

### 5.1 Regelbetrieb: Restore zuerst testen, dann scharf schalten

```bash
# a) Probe-Restore in eine Scratch-DB (Live-DB bleibt unberuehrt).
RESTORE_CONFIRM=yes TARGET_DB=ez_restore_probe \
  bash scripts/restore.sh backups/einkaufszettel-<TS>.sql.gz
# b) Stichproben in der Scratch-DB ...
docker compose exec -T db psql -U postgres -d ez_restore_probe \
  -tAc "select count(*) from public.categories"       # 13
# c) Scratch-DB wieder entfernen.
docker compose exec -T db dropdb -U postgres ez_restore_probe
```

### 5.2 Disaster Recovery (Live-DB ist verloren)

```bash
cd /opt/einkaufszettel

# 1) Stack ggf. stoppen, damit keine Schreiber mehr laufen.
docker compose stop web auth rest

# 2) Zieldatenbank neu aufsetzen und Backup einspielen.
#    (TARGET_DB = Name der Live-DB, z. B. "postgres")
RESTORE_CONFIRM=yes TARGET_DB=postgres RESTORE_DROP_EXISTING=yes \
  bash scripts/restore.sh backups/einkaufszettel-<TS>.sql.gz

# 3) Stack starten und Health pruefen.
docker compose up -d
docker compose ps
curl -fsS "https://${DOMAIN}/health"
```

> Hinweis: Der Dump enthält die gecoverten Supabase-Schemas/Rollen. Ein
> Restore in die Live-DB überschreibt bestehende Daten (daher
> `RESTORE_DROP_EXISTING=yes` + Freigabe).

---

## 6. Restore-Test

`scripts/test-restore.sh` beweist, dass `backup.sh` und `restore.sh`
zusammenarbeiten und Daten vollständig wiederhergestellt werden.

```bash
bash scripts/test-restore.sh --mode auto      # real, wenn PG vorhanden, sonst stub
bash scripts/test-restore.sh --mode real      # erzwungen: braucht PostgreSQL-Binaries
bash scripts/test-restore.sh --mode stub      # nur Statik + Negativ-Tests
bash scripts/test-restore.sh --mode dry-run   # nur Archiv-Vorpruefung
```

**Modus `real`** (End-to-End, selbst aufräumend):

1. `initdb` eines temporären Clusters auf einem freien Port.
2. Quell-DB `ez_src`: Migrationen + Seed (bzw. Fixture, falls keine
   Migrationen vorhanden).
3. `backup.sh` erzeugt ein Archiv.
4. `restore.sh` spielt es in `ez_restored` ein.
5. **Abgleich** je public-Tabelle: Zeilenzahl **und** MD5-Checksumme
   (`md5(string_agg(x::text ...))`) müssen identisch sein — bit-genau.
6. Negativ-Tests: Überschreibschutz (Exit 5), Retention löscht nur Alte.
7. **Regression** (Fix Review-Runde 1): Restore in die Compose-Default-DB
   `postgres` — erst leer (ohne Drop), dann mit `RESTORE_DROP_EXISTING=yes`
   (erzwingt Drop/Create über die Maintenance-DB `template1`); prüft, dass
   `postgres` danach die Fachtabellen enthält.
8. **Regression** (Fix Review-Runde 2, `DATABASE_URL`-Modus, ohne libpq-Env):
   - **URL-Pfad ≠ `TARGET_DB`:** Restore landet in `TARGET_DB`; die im URL-Pfad
     genannte DB bleibt unberührt (kein stiller Falschziel-Restore).
   - **DR-Pfad (URL zeigt auf das Ziel selbst, Ziel nicht leer,
     `RESTORE_DROP_EXISTING=yes`):** Drop/Create laufen über die
     (umgeschriebene) Maintenance-URL, Exit 0, die Live-DB bleibt erhalten.

PostgreSQL-Binaries werden gesucht in `$PG_BIN`, `$PATH`, `pg_config --bindir`
und bekannten portablen Pfaden.

**Lokaler Nachweis dieser Welle** (siehe
[`docs/TESTLOG-T5.4.md`](./TESTLOG-T5.4.md)): 37/37 Checks grün, u. a.

```
categories         count=13 md5=560784a3e0b3
category_rules     count=389 md5=e6a8c018475b
alle Tabellen: count UND md5 identisch (vollstaendig, bit-genau)
Regression: TARGET_DB=postgres mit Drop/Create ueber Maintenance-DB erfolgreich
DATABASE_URL: Zieldaten in TARGET_DB 'ez_url_target' (11 Tabellen)
DATABASE_URL: URL-Pfad-DB 'ez_urlpath' blieb unberuehrt (0 Tabellen)
DATABASE_URL: DR-Ziel 'ez_url_dr' enthaelt nach Restore 11 Tabellen (Live-DB erhalten)
==== ERGEBNIS: 37 bestanden, 0 fehlgeschlagen (Modus real) ====
```

Auf einem Host **ohne** PostgreSQL-Binaries läuft `--mode auto` auf `stub`
zurück (9/9 Checks, u. a. alle Sicherheits-Abbruchpfade). Der volle Lauf ist
dann ein offener Host-Nachweis (analog D14/T1.3).

---

## 7. Zertifikatsablauf (Cert-Expiry)

`scripts/check-cert-expiry.sh` prüft das Ablaufdatum eines X.509-Zertifikats —
per Datei, Glob oder Live-Endpoint — und liefert einen Monitoring-tauglichen
Exit-Code.

```bash
bash scripts/check-cert-expiry.sh /etc/ssl/fullchain.pem
bash scripts/check-cert-expiry.sh "${DOMAIN}:443"           # Live-TLS
CERT_FILE=/path/cert.pem CERT_WARN_DAYS=21 bash scripts/check-cert-expiry.sh
```

| Exit | Bedeutung                                   |
| ---- | ------------------------------------------- |
| 0    | gültig, Restlaufzeit > Schwelle             |
| 1    | gültig, Restlaufzeit ≤ Schwelle (**Alarm**) |
| 2    | Fehler (kein Zertifikat lesbar)             |
| 3    | Zertifikat **abgelaufen**                   |

Schwelle: `CERT_WARN_DAYS` (Default **14**). Caddy erneuert Let's-Encrypt-
Zertifikate automatisch; dieser Check belegt, dass die Erneuerung tatsächlich
greift (Risiko „Zertifikatserneuerung schlägt still fehl", PLAN.md §6).

**Caddy-Volume-Variante** (kein externer Port nötig):

```bash
CERT_GLOB='/var/lib/docker/volumes/einkaufszettel_caddy-data/_data/caddy/certificates/*/*/*.crt' \
  bash scripts/check-cert-expiry.sh
```

---

## 8. Monitoring

### 8.1 Entscheidung: optionaler Compose-Service statt fester Bestandteil

**Umgangssprache-Entscheidung:** Uptime Kuma wird als **optionaler Dienst mit
dem Compose-Profil `monitoring`** ausgeliefert, **standardmäßig aus**.

Begründung:

- Der Kern-Stack bleibt bewusst reduziert (siehe PLAN.md) und der normale
  Start wird **nicht** verzögert (Profil startet nicht ohne `--profile`).
- Uptime Kuma läuft trotzdem reproduzierbar und versioniert wie der Rest des
  Stacks (kein manuell installierter Nebenschauplatz).
- Wer Monitoring lieber **extern** (anderes Gerät im Heimnetz, bestehende
  Instanz, Healthchecks.io) betreibt, lässt den Dienst einfach weg und nutzt
  dieselben Checks.

```bash
docker compose --profile monitoring up -d uptime-kuma
# UI: http://<host>:${UPTIME_KUMA_PORT:-3001}  (Erst-Einrichtung im Browser)
```

### 8.2 Checks und Alarmweg

| Check              | Quelle                                             | Frequenz  | Alarm wenn |
| ------------------ | -------------------------------------------------- | --------- | ---------- |
| Verfügbarkeit App  | `GET https://${DOMAIN}/health` (HTTP 200)          | 60 s      | != 200     |
| TLS-Zertifikat     | `check-cert-expiry.sh ${DOMAIN}:443`               | täglich   | Exit 1/2/3 |
| Container-Health   | `docker compose ps` (bzw. Docker-Health)           | 60 s      | unhealthy  |
| Backup erfolgreich | `backup.sh` Exit 0 + frisches Archiv in `backups/` | täglich   | Exit != 0  |
| Restore-Test       | `test-restore.sh --mode auto`                      | wöchentl. | Exit != 0  |
| Disk-Auslastung    | Host (z. B. node_exporter)                         | 5 min     | > 85 %     |

**Alarmweg (Vorschlag):** Uptime Kuma-Benachrichtigungen für „App down" und
„Zertifikat < 14 Tage"; die Cron-Jobs für Backup/Restore/Cert schreiben in
`backups/*.log` und lösen bei Exit != 0 einen systemd-`OnFailure`- oder
Mail-Alarm aus. Mindestens _ein_ Kanal (E-Mail/Telegram) muss konfiguriert
sein — ein Monitor ohne Alarmierung hat keinen Nutzen.

**Uptime-Kuma-Check für das Zertifikat:** Entweder ein _Keyword_-Monitor auf
`/health` + separater _Push_-Monitor, den der Cron-`check-cert-expiry.sh`
bei Exit 1 anpingt, oder ein HTTP-Monitor auf `https://${DOMAIN}` mit
aktivierter „Certificate Expiry Notification".

---

## 9. Notfall-Kurzreferenz

| Symptom                     | Erste Schritte                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------- |
| App nicht erreichbar        | `docker compose ps`; `docker compose logs --since 10m web caddy`; `/health`           |
| Datenverlust / DB korrupt   | Abschnitt 5.2 (Disaster Recovery)                                                     |
| Zertifikat abgelaufen       | `docker compose logs caddy \| grep -i cert`; `docker compose exec caddy caddy reload` |
| Backup schlägt fehl         | `bash scripts/backup.sh` manuell; `gzip -t` auf das letzte Archiv; Speicherplatz      |
| Logs wachsen unkontrolliert | Abschnitt 3 (Rotation prüfen), `du -sh /var/lib/docker/containers/*/*-json.log`       |

---

## 10. Host-Nachweise (in der Sandbox nicht ausführbar)

Ohne laufenden Docker-Daemon bleiben folgende Schritte **offen** und müssen
auf dem Docker-Host nachgeholt werden (analog D14/T1.3):

1. `docker compose up -d --build` → 5 Dienste `healthy`.
2. `docker compose --profile monitoring up -d` → 6. Dienst erreichbar.
3. `curl -fsS "https://${DOMAIN}/health"` → `{"status":"ok"}`.
4. Restore-Test **gegen die echte Compose-DB** (`test-restore.sh --mode real`
   mit `PGHOST`/`DATABASE_URL` auf den `db`-Container) statt gegen das
   portable PostgreSQL.

Statisch bereits **hier** belegt: `docker compose config -q` → Exit 0
(Compose-Plugin arbeitet ohne Daemon), 5 Dienste ohne / 6 mit Profil,
Logging-Block bei allen Diensten gerendert. Siehe
[`docs/TESTLOG-T5.4.md`](./TESTLOG-T5.4.md).
