#!/usr/bin/env bash
# =============================================================================
# Einkaufszettel — lokale Verifikation OHNE Docker/supabase-CLI
# =============================================================================
# Baut eine Wegwerf-Datenbank auf einer bereits laufenden PostgreSQL-Instanz
# auf, spielt Supabase-Shim + pgTAP + alle Migrationen + Seed ein und fuehrt
# beide pgTAP-Suiten aus. Gedacht fuer Sandboxes/CI ohne Docker-Daemon.
#
# Voraussetzungen (per Env-Variable konfigurierbar):
#   PGROOT  Verzeichnis mit client/ (psql) und pgsrv/ (Server-Bibliotheken)
#           sowie bootstrap.sql + pgtap_ready.sql  [Default: $HOME/pg-shim]
#   PGPORT  Port der laufenden Instanz               [Default: 55432]
#   PGHOST  Socket-/Host-Verzeichnis                 [Default: /tmp]
#   PGUSER  Superuser der Instanz                    [Default: postgres]
#
# Aufruf:  bash supabase/tests/run_local_verify.sh
# Exit:    0 = alles gruen, sonst 1.
# =============================================================================
set -uo pipefail

PGROOT="${PGROOT:-$HOME/pg-shim}"
PORT="${PGPORT:-55432}"
SOCK="${PGHOST:-/tmp}"
DBUSER="${PGUSER:-postgres}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="verify_$$_$(date +%s)"

export LD_LIBRARY_PATH="$PGROOT/client/usr/lib/x86_64-linux-gnu:$PGROOT/pgsrv/lib:${LD_LIBRARY_PATH:-}"
PSQL="$(command -v psql || true)"
if [ -z "$PSQL" ] && [ -x "$PGROOT/client/usr/lib/postgresql/17/bin/psql" ]; then
  PSQL="$PGROOT/client/usr/lib/postgresql/17/bin/psql"
fi
if [ -z "$PSQL" ]; then
  echo "FEHLER: psql nicht gefunden (weder im PATH noch unter \$PGROOT)." >&2
  exit 1
fi

say() { printf '\n=== %s ===\n' "$*"; }
run_sql() { # run_sql <datei> <label>
  local f="$1" label="$2"
  say "$label"
  "$PSQL" -h "$SOCK" -p "$PORT" -U "$DBUSER" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
  local rc=$?
  echo "--> exit=$rc"
  return $rc
}

say "0. Server erreichbar?"
"$PSQL" -h "$SOCK" -p "$PORT" -U "$DBUSER" -tAc "select version();" || exit 1

say "1. Wegwerf-Datenbank $DB anlegen"
"$PSQL" -h "$SOCK" -p "$PORT" -U "$DBUSER" -q -c "create database \"$DB\";" || exit 1

say "2. Supabase-Shim (Rollen, auth-Schema, auth.uid)"
"$PSQL" -h "$SOCK" -p "$PORT" -U "$DBUSER" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$PGROOT/bootstrap.sql" || exit 1
echo ok

say "3. pgTAP laden"
"$PSQL" -h "$SOCK" -p "$PORT" -U "$DBUSER" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$PGROOT/pgtap_ready.sql" >/dev/null || exit 1
echo ok

# 001/002 sind Basisschema-Migrationen (CREATE TYPE/TABLE/TRIGGER) und laufen
# genau einmal pro Datenbank. 003/004 sind funktionale Migrationen und muessen
# idempotent sein (CREATE OR REPLACE / DROP IF EXISTS) — sie laufen zweimal.
say "4a. Basisschema 001 + 002 (einmalig)"
run_sql "$REPO/supabase/migrations/20261025_001_schema.sql" "Migration 001_schema" || exit 1
run_sql "$REPO/supabase/migrations/20261025_002_rls.sql"    "Migration 002_rls"    || exit 1

say "4b. Funktionale Migrationen 003 + 004 (je zweimal = Idempotenz)"
for m in 20261025_003_rpc_household_lists.sql \
         20261025_004_fix_lists_rls.sql; do
  run_sql "$REPO/supabase/migrations/$m" "Migration $m (1. Lauf)" || exit 1
  run_sql "$REPO/supabase/migrations/$m" "Migration $m (2. Lauf = Idempotenz)" || exit 1
done

say "5. Seed (idempotent, zweimal)"
run_sql "$REPO/supabase/seed.sql" "Seed (1. Lauf)" || exit 1
run_sql "$REPO/supabase/seed.sql" "Seed (2. Lauf = Idempotenz)" || exit 1

say "6. pgTAP 01_rls"
"$PSQL" -h "$SOCK" -p "$PORT" -U "$DBUSER" -d "$DB" -f "$REPO/supabase/tests/01_rls.sql"
rc1=$?
echo "--> exit=$rc1"

say "7. pgTAP 02_rpc_household_lists"
"$PSQL" -h "$SOCK" -p "$PORT" -U "$DBUSER" -d "$DB" -f "$REPO/supabase/tests/02_rpc_household_lists.sql"
rc2=$?
echo "--> exit=$rc2"

say "8. Ergebnis"
if [ "$rc1" -eq 0 ] && [ "$rc2" -eq 0 ]; then
  echo "ALLE TESTS GRUEN"
  exit 0
fi
echo "MINDESTENS EINE SUITE ROT" >&2
exit 1
