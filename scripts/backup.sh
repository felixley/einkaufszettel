#!/usr/bin/env bash
# Erzeugt ein pg_dump-Archiv der Compose-Datenbank.
# Keine destruktiven Schritte; Restore-Test gehoert zu T5.4.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/einkaufszettel-$timestamp.sql.gz"
tmp="$out.tmp"

cleanup() {
  rm -f "$tmp"
}
trap cleanup EXIT

if command -v pg_dump >/dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ]; then
  pg_dump "$DATABASE_URL" | gzip >"$tmp"
elif command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T db \
    pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip >"$tmp"
else
  echo "Fehler: weder pg_dump+DATABASE_URL noch Docker Compose verfuegbar." >&2
  exit 1
fi

if [ ! -s "$tmp" ]; then
  echo "Fehler: Backup ist leer." >&2
  exit 1
fi

mv "$tmp" "$out"
trap - EXIT
echo "Backup erstellt: $out"
