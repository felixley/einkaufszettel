#!/usr/bin/env bash
# =============================================================================
# backup.sh — pg_dump-Archiv der Compose-Datenbank erzeugen (T5.4).
#
# Eigenschaften:
#   * Dump bevorzugt ueber lokale libpq (DATABASE_URL oder PGHOST/PGPORT/...),
#     sonst Fallback via `docker compose exec` gegen den `db`-Service.
#   * Atomares Schreiben: erst nach .part, dann Integritaetspruefung, dann mv.
#   * Integritaetspruefung: nicht-leer, `gzip -t` gruen, PG-Dump-Signatur.
#   * SHA-256 + Metadaten als Sidecar-Datei (<name>.meta).
#   * Retention: loescht Archive aelter als RETENTION_DAYS (Default 14).
#   * Keine destruktiven Aktionen ausser der Retention (nur passende Dateien).
#
# Aufruf:
#   bash scripts/backup.sh
#
# Relevante Env-Variablen:
#   BACKUP_DIR      Zielverzeichnis (Default: <repo>/backups)
#   POSTGRES_DB     DB-Name fuer pg_dump/Docker (Default: postgres)
#   POSTGRES_USER   DB-User fuer pg_dump/Docker (Default: postgres)
#   RETENTION_DAYS  Aufbewahrung in Tagen (Default: 14)
#   DRY_RUN=1       nur anzeigen, was die Retention loeschen wuerde
#   DATABASE_URL    vollstaendige libpq-URL (optional)
#   PGHOST/PGPORT/PGUSER/PGPASSWORD  libpq-Einzelwerte (optional)
#   COMPOSE_FILE    Pfad zur Compose-Datei (Default: <repo>/docker-compose.yml)
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.yml}"
DRY_RUN="${DRY_RUN:-0}"

log() { printf '%s [backup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "FEHLER: $*" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/einkaufszettel-$timestamp.sql.gz"
meta="$BACKUP_DIR/einkaufszettel-$timestamp.meta"
part="$out.part"

cleanup() { rm -f -- "$part"; }
trap cleanup EXIT

# --- 1. Dump erzeugen --------------------------------------------------------
if command -v pg_dump >/dev/null 2>&1 && { [ -n "${DATABASE_URL:-}" ] || [ -n "${PGHOST:-}" ]; }; then
  source_kind="pg_dump"
  if [ -n "${DATABASE_URL:-}" ]; then
    pg_dump "$DATABASE_URL" | gzip -9 >"$part"
  else
    pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip -9 >"$part"
  fi
elif command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  source_kind="docker-compose"
  docker compose -f "$COMPOSE_FILE" exec -T db \
    pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip -9 >"$part"
else
  fail "weder lokale libpq (pg_dump + DATABASE_URL/PGHOST) noch Docker Compose verfuegbar."
fi

# --- 2. Integritaetspruefung -------------------------------------------------
[ -s "$part" ] || fail "Backup ist leer."
gzip -t -- "$part" 2>/dev/null || fail "gzip-Integritaetspruefung fehlgeschlagen (beschaedigtes Archiv)."
# Signatur pruefen; `|| true` faengt SIGPIPE durch head bei pipefail ab.
header="$(gzip -dc -- "$part" 2>/dev/null | head -c 512 || true)"
case "$header" in
  *"PostgreSQL database dump"*) : ;;
  *) fail "Archiv enthaelt keinen PostgreSQL-Dump-Kopf." ;;
esac

# --- 3. Atomar veroeffentlichen + Metadaten ----------------------------------
mv -- "$part" "$out"
trap - EXIT
bytes="$(wc -c <"$out" | tr -d ' ')"
sha="$(sha256sum -- "$out" | cut -d' ' -f1)"
{
  printf 'timestamp=%s\n' "$timestamp"
  printf 'source=%s\n' "$source_kind"
  printf 'database=%s\n' "$POSTGRES_DB"
  printf 'file=%s\n' "$(basename -- "$out")"
  printf 'bytes=%s\n' "$bytes"
  printf 'sha256=%s\n' "$sha"
} >"$meta"
log "Backup erstellt: $out ($bytes Byte, sha256=$sha, Quelle=$source_kind)"

# --- 4. Retention ------------------------------------------------------------
# Loescht ausschliesslich Dateien des eigenen Namensschemas aelter als die Frist.
now="$(date +%s)"
cutoff=$(( RETENTION_DAYS * 86400 ))
removed=0
shopt -s nullglob
for f in "$BACKUP_DIR"/einkaufszettel-*.sql.gz "$BACKUP_DIR"/einkaufszettel-*.meta; do
  [ -f "$f" ] || continue
  mtime="$(stat -c %Y -- "$f")"
  if [ $(( now - mtime )) -gt "$cutoff" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      log "DRY-RUN: Retention wuerde loeschen: $f"
    else
      log "Retention: loesche $f (aelter als ${RETENTION_DAYS} Tage)"
      rm -f -- "$f"
    fi
    removed=$(( removed + 1 ))
  fi
done
shopt -u nullglob
log "Retention: ${removed} Datei(en) aelter als ${RETENTION_DAYS} Tage behandelt."
