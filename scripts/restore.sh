#!/usr/bin/env bash
# =============================================================================
# restore.sh — Stellt ein pg_dump-Archiv (.sql.gz) in eine Zieldatenbank wieder her.
#
# Sicherheitsprinzipien (T5.4):
#   1. Ziel-DB MUSS explizit ueber TARGET_DB gesetzt sein (kein Default, keine
#      Rateheuristik) — verhindert versehentliches Ueberschreiben der Live-DB.
#   2. Restore nur mit expliziter Bestaetigung RESTORE_CONFIRM=yes.
#   3. Vorpruefung des Archivs: vorhanden, `gzip -t` gruen, PG-Dump-Signatur.
#   4. Ein Ziel mit vorhandenen Tabellen wird nur mit RESTORE_DROP_EXISTING=yes
#      verworfen (sonst Abbruch).
#   5. psql laeuft mit ON_ERROR_STOP=1 -> Abbruch beim ersten SQL-Fehler; das
#      Skript endet dann mit Exit-Code != 0.
#
# Aufruf:
#   RESTORE_CONFIRM=yes TARGET_DB=einkaufszettel_restore \
#     ./scripts/restore.sh backups/einkaufszettel-20261025T112706Z.sql.gz
#
# Vorflug ohne Datenbank (nur Pruefungen):
#   RESTORE_CONFIRM=yes TARGET_DB=einkaufszettel_restore RESTORE_DRY_RUN=1 \
#     ./scripts/restore.sh backups/xxx.sql.gz
#
# Relevante Env-Variablen:
#   TARGET_DB            (Pflicht) Zieldatenbank-Name
#   RESTORE_CONFIRM=yes  (Pflicht) Bestaetigung
#   RESTORE_DROP_EXISTING=yes  erlaubt das Verwerfen eines nicht-leeren Ziels
#   RESTORE_DRY_RUN=1    nur Pruefungen, kein DB-Zugriff
#   POSTGRES_USER        DB-User (Default: postgres)
#   DATABASE_URL         vollstaendige libpq-URL (optional; Zieldb muss passen)
#   PGHOST/PGPORT/PGPASSWORD  libpq-Einzelwerte (optional)
#   COMPOSE_FILE         Pfad zur Compose-Datei (Default: <repo>/docker-compose.yml)
#
# Exit-Codes:
#   0 Erfolg | 2 Argumente/Datei | 3 fehlende Bestaetigung | 4 beschaedigtes
#   Archiv | 5 Ziel nicht leer ohne Freigabe | 6 Verbindungsfehler/Ziel fehlt |
#   7 Restore-Fehler
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
TARGET_DB="${TARGET_DB:-}"
MAINT_DB="${MAINT_DB:-postgres}"

log() { printf '%s [restore] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

usage() {
  sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# --- 0. Argumente ------------------------------------------------------------
file="${1:-}"
if [ -z "$file" ]; then
  log "FEHLER: kein Archiv angegeben."
  usage
  exit 2
fi
if [ ! -f "$file" ]; then
  log "FEHLER: Datei nicht gefunden: $file"
  exit 2
fi
if [ -z "$TARGET_DB" ]; then
  log "FEHLER: TARGET_DB muss explizit gesetzt werden (kein Default)."
  exit 2
fi
case "$TARGET_DB" in
  postgres|template0|template1) log "FEHLER: '$TARGET_DB' ist keine zulaessige Zieldatenbank."; exit 2 ;;
esac

# --- 1. Bestaetigung (Schutz vor versehentlichem Ueberschreiben) -------------
if [ "${RESTORE_CONFIRM:-}" != "yes" ]; then
  log "ABBRUCH: Restore erfordert die explizite Bestaetigung RESTORE_CONFIRM=yes."
  log "         Ziel waere: $TARGET_DB  —  Quelle: $file"
  exit 3
fi

# --- 2. Archiv-Vorpruefung ---------------------------------------------------
gzip -t -- "$file" 2>/dev/null || { log "FEHLER: gzip-Pruefung fehlgeschlagen: $file"; exit 4; }
header="$(gzip -dc -- "$file" 2>/dev/null | head -c 512 || true)"
case "$header" in
  *"PostgreSQL database dump"*) : ;;
  *) log "FEHLER: kein PostgreSQL-Dump-Kopf in $file"; exit 4 ;;
esac
log "Archiv ok: $file"

# --- 3. Verbindungsmodus bestimmen -------------------------------------------
MODE=""
if command -v psql >/dev/null 2>&1 && { [ -n "${PGHOST:-}" ] || [ -n "${DATABASE_URL:-}" ]; }; then
  MODE="local"
elif command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  MODE="docker"
else
  log "FEHLER: weder lokale libpq (psql + PGHOST/DATABASE_URL) noch Docker Compose verfuegbar."
  exit 6
fi
log "Verbindungsmodus: $MODE  ->  Ziel '$TARGET_DB'"

if [ "${RESTORE_DRY_RUN:-0}" = "1" ]; then
  log "DRY-RUN: wuerde '$file' via $MODE in '$TARGET_DB' einspielen (kein DB-Zugriff)."
  exit 0
fi

# --- 4. Helfer fuer DB-Zugriff ----------------------------------------------
# psql_maint <sql>: SQL gegen die Maintenance-DB (Existenz/DROP).
psql_maint() {
  local sql="$1"
  if [ "$MODE" = "local" ]; then
    if [ -n "${DATABASE_URL:-}" ]; then psql "$DATABASE_URL" -tAc "$sql"; else psql -d "$MAINT_DB" -tAc "$sql"; fi
  else
    docker compose -f "$COMPOSE_FILE" exec -T db psql -U "$POSTGRES_USER" -d "$MAINT_DB" -tAc "$sql"
  fi
}
# psql_target <sql|->: SQL gegen die Zieldatenbank.
psql_target() {
  if [ "$MODE" = "local" ]; then
    if [ -n "${DATABASE_URL:-}" ]; then psql "$DATABASE_URL" "$@"; else psql -d "$TARGET_DB" "$@"; fi
  else
    docker compose -f "$COMPOSE_FILE" exec -T db psql -U "$POSTGRES_USER" -d "$TARGET_DB" "$@"
  fi
}
# stream_into_target: SQL-Strom von stdin in die Zieldatenbank.
stream_into_target() {
  psql_target -v ON_ERROR_STOP=1 -q -X
}

exists="$(psql_maint "select 1 from pg_database where datname = '$TARGET_DB'" | tr -d '[:space:]')"

# --- 5. Ziel vorbereiten -----------------------------------------------------
if [ "$exists" = "1" ]; then
  ntab="$(psql_target -tAc "select count(*) from information_schema.tables where table_schema='public'" | tr -d '[:space:]')"
  if [ "${ntab:-0}" != "0" ]; then
    if [ "${RESTORE_DROP_EXISTING:-}" != "yes" ]; then
      log "ABBRUCH: Ziel '$TARGET_DB' enthaelt bereits ${ntab} Tabellen in public."
      log "         Zum Verwerfen RESTORE_DROP_EXISTING=yes setzen."
      exit 5
    fi
    log "Ziel '$TARGET_DB' wird verworfen (RESTORE_DROP_EXISTING=yes)."
    if [ "$MODE" = "local" ]; then
      if [ -n "${DATABASE_URL:-}" ]; then
        psql "$(printf '%s' "$DATABASE_URL" | sed 's#/[^/]*$#/'"$MAINT_DB"'#')" -tAc "drop database if exists \"$TARGET_DB\"" >/dev/null
      else
        dropdb --if-exists "$TARGET_DB"
      fi
      createdb "$TARGET_DB"
    else
      docker compose -f "$COMPOSE_FILE" exec -T db dropdb -U "$POSTGRES_USER" --if-exists "$TARGET_DB"
      docker compose -f "$COMPOSE_FILE" exec -T db createdb -U "$POSTGRES_USER" "$TARGET_DB"
    fi
  else
    log "Ziel '$TARGET_DB' existiert und ist leer — Restore ohne Verwerfen."
  fi
else
  log "Ziel '$TARGET_DB' existiert nicht — wird angelegt."
  if [ "$MODE" = "local" ]; then
    if [ -n "${DATABASE_URL:-}" ]; then
      psql "$(printf '%s' "$DATABASE_URL" | sed 's#/[^/]*$#/'"$MAINT_DB"'#')" -tAc "create database \"$TARGET_DB\"" >/dev/null
    else
      createdb "$TARGET_DB"
    fi
  else
    docker compose -f "$COMPOSE_FILE" exec -T db createdb -U "$POSTGRES_USER" "$TARGET_DB"
  fi
fi

# --- 6. Restore --------------------------------------------------------------
log "Spiele Archiv ein (ON_ERROR_STOP=1) ..."
if ! gzip -dc -- "$file" | stream_into_target >/dev/null; then
  log "FEHLER: Restore in '$TARGET_DB' fehlgeschlagen (SQL-Fehler)."
  exit 7
fi

# --- 7. Nachkontrolle --------------------------------------------------------
ntab_after="$(psql_target -tAc "select count(*) from information_schema.tables where table_schema='public'" | tr -d '[:space:]')"
if [ "${ntab_after:-0}" = "0" ]; then
  log "FEHLER: Nach dem Restore sind keine public-Tabellen vorhanden."
  exit 7
fi
log "Restore abgeschlossen: '$TARGET_DB' (${ntab_after} Tabellen in public)."
