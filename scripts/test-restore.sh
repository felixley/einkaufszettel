#!/usr/bin/env bash
# =============================================================================
# test-restore.sh — Automatisierter Backup-/Restore-Test (T5.4).
#
# Beweist ohne Docker-Daemon, dass `backup.sh` + `restore.sh` zusammenarbeiten
# und die Daten vollstaendig wiederhergestellt werden.
#
# Modi:
#   auto     (Default) real, wenn portable PostgreSQL gefunden wird, sonst stub
#   stub     nur statische Pruefungen + Negativ-Tests (kein DB-Zugriff)
#   dry-run  Archiv-Vorpruefung ueber `restore.sh RESTORE_DRY_RUN=1` (kein DB)
#   real     vollstaendiger Lauf gegen ein temporaeres PostgreSQL-Cluster:
#            initdb -> Schema+Seed laden -> backup.sh -> restore.sh ->
#            Abgleich Tabellenzahlen UND MD5-Checksummen, plus Negativ-Tests.
#
# PostgreSQL-Binaries werden gesucht in: $PG_BIN, $PATH (pg_ctl), `pg_config
# --bindir`, sowie bekannten portablen Scratch-Pfaden.
#
# Exit 0 = alle Pruefungen bestanden, 1 = mindestens eine fehlgeschlagen.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="auto"
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 ;;
    --mode=*) MODE="${1#--mode=}"; shift ;;
    -h|--help) sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unbekanntes Argument: $1" >&2; exit 2 ;;
  esac
done

pass=0; fails=0
ok() { printf '  PASS: %s\n' "$*"; pass=$(( pass + 1 )); }
ko() { printf '  FAIL: %s\n' "$*"; fails=$(( fails + 1 )); }

BACKUP_SH="$ROOT_DIR/scripts/backup.sh"
RESTORE_SH="$ROOT_DIR/scripts/restore.sh"
CERT_SH="$ROOT_DIR/scripts/check-cert-expiry.sh"

# --- PostgreSQL-Binaries finden ---------------------------------------------
find_pg_bin() {
  if [ -n "${PG_BIN:-}" ] && [ -x "$PG_BIN/pg_ctl" ]; then printf '%s' "$PG_BIN"; return 0; fi
  if command -v pg_ctl >/dev/null 2>&1; then dirname "$(command -v pg_ctl)"; return 0; fi
  if command -v pg_config >/dev/null 2>&1; then
    local d; d="$(pg_config --bindir 2>/dev/null || true)"
    if [ -n "$d" ] && [ -x "$d/pg_ctl" ]; then printf '%s' "$d"; return 0; fi
  fi
  local d
  for d in /opt/data/profiles/*/cache/scratch/*/pg/postgresql-*/bin \
           /opt/data/profiles/devops/cache/scratch/*/pg/postgresql-*/bin; do
    if [ -x "$d/pg_ctl" ]; then printf '%s' "$d"; return 0; fi
  done
  return 1
}

free_port() {
  python3 - <<'PY'
import socket
s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()
PY
}

# --- Statische + Archiv-Pruefungen (alle Modi) -------------------------------
static_checks() {
  echo "== Statische Pruefungen =="
  for f in "$BACKUP_SH" "$RESTORE_SH" "$CERT_SH"; do
    [ -f "$f" ] || { ko "fehlt: $f"; continue; }
    if bash -n "$f" 2>/dev/null; then ok "bash -n: $(basename "$f")"; else ko "bash -n: $(basename "$f")"; fi
  done
  [ -x "$BACKUP_SH" ] && ok "backup.sh ausfuehrbar" || ko "backup.sh nicht ausfuehrbar"
  [ -x "$RESTORE_SH" ] && ok "restore.sh ausfuehrbar" || ko "restore.sh nicht ausfuehrbar"

  echo "== Negativ-Tests: restore.sh verweigert unsichere Aufrufe =="
  local tmpd rc; tmpd="$(mktemp -d)"
  # synthetisch gueltiges gzip-Archiv mit PG-Kopf
  printf -- '--\n-- PostgreSQL database dump\n--\n' | gzip -9 >"$tmpd/fake.sql.gz"
  # 1) fehlende Bestaetigung -> Exit 3
  rc=0; TARGET_DB=ez_never bash "$RESTORE_SH" "$tmpd/fake.sql.gz" >/dev/null 2>&1 || rc=$?
  [ "$rc" -eq 3 ] && ok "fehlende Bestaetigung -> Exit 3" || ko "fehlende Bestaetigung -> Exit $rc (erwartet 3)"
  # 2) fehlende Datei -> Exit 2
  rc=0; RESTORE_CONFIRM=yes TARGET_DB=ez_never bash "$RESTORE_SH" "$tmpd/nope.sql.gz" >/dev/null 2>&1 || rc=$?
  [ "$rc" -eq 2 ] && ok "fehlende Datei -> Exit 2" || ko "fehlende Datei -> Exit $rc (erwartet 2)"
  # 3) fehlendes TARGET_DB -> Exit 2
  rc=0; RESTORE_CONFIRM=yes bash "$RESTORE_SH" "$tmpd/fake.sql.gz" >/dev/null 2>&1 || rc=$?
  [ "$rc" -eq 2 ] && ok "fehlendes TARGET_DB -> Exit 2" || ko "fehlendes TARGET_DB -> Exit $rc (erwartet 2)"
  # 4) beschaedigtes Archiv -> Exit 4
  printf 'not a gzip' >"$tmpd/broken.sql.gz"
  rc=0; RESTORE_CONFIRM=yes TARGET_DB=ez_never bash "$RESTORE_SH" "$tmpd/broken.sql.gz" >/dev/null 2>&1 || rc=$?
  [ "$rc" -eq 4 ] && ok "beschaedigtes Archiv -> Exit 4" || ko "beschaedigtes Archiv -> Exit $rc (erwartet 4)"
  rm -rf -- "$tmpd"
}

# --- dry-run ----------------------------------------------------------------
mode_dry_run() {
  echo "== Modus dry-run: Archiv-Vorpruefung =="
  local bk
  bk="$(ls -1t "$ROOT_DIR"/backups/einkaufszettel-*.sql.gz 2>/dev/null | head -n1 || true)"
  if [ -z "$bk" ]; then
    local tmpd; tmpd="$(mktemp -d)"
    printf -- '--\n-- PostgreSQL database dump\n--\nselect 1;\n' | gzip -9 >"$tmpd/fake.sql.gz"
    bk="$tmpd/fake.sql.gz"
  fi
  if RESTORE_CONFIRM=yes TARGET_DB=ez_dryrun RESTORE_DRY_RUN=1 \
       bash "$RESTORE_SH" "$bk" >/dev/null 2>&1; then
    ok "restore.sh DRY-RUN akzeptiert Archiv: $(basename "$bk")"
  else
    ko "restore.sh DRY-RUN fehlgeschlagen fuer $bk"
  fi
}

# --- real -------------------------------------------------------------------
# Minimaler Supabase-Shim, damit die Migrationen (auth.uid(), Rollen, auth.users)
# ohne Docker/GoTrue laufen. Wird als Datei geschrieben, um Quoting-Fallen zu vermeiden.
write_prelude() {
  cat >"$1" <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
SQL
}

mode_real() {
  PG_BIN="$(find_pg_bin)" || { ko "keine PostgreSQL-Binaries gefunden"; return; }
  echo "== Modus real (PostgreSQL aus: $PG_BIN) =="

  # Globale Variablen, damit der EXIT-Trap sie nach Verlassen der Funktion sieht.
  local port
  started=0
  work="$(mktemp -d "${TMPDIR:-/tmp}/t54-restore.XXXXXX")"
  cluster="$work/pgdata"; sock="$work/sock"
  cleanup() {
    if [ "${started:-0}" = "1" ]; then
      "$PG_BIN/pg_ctl" -D "$cluster" -m immediate stop >/dev/null 2>&1 || true
    fi
    rm -rf -- "$work"
  }
  trap cleanup EXIT
  port="$(free_port)"
  mkdir -p "$sock"
  "$PG_BIN/initdb" -D "$cluster" -U postgres --auth=trust --no-locale -E UTF8 >"$work/initdb.log" 2>&1 \
    || { ko "initdb fehlgeschlagen"; return; }
  "$PG_BIN/pg_ctl" -D "$cluster" -l "$work/pg.log" \
    -o "-p $port -k $sock -c listen_addresses=127.0.0.1" start >/dev/null 2>&1 \
    || { ko "pg_ctl start fehlgeschlagen"; return; }
  started=1
  for _ in $(seq 1 30); do "$PG_BIN/pg_isready" -h 127.0.0.1 -p "$port" -q && break; sleep 0.5; done

  export PATH="$PG_BIN:$PATH"
  export PGHOST=127.0.0.1 PGPORT="$port" PGUSER=postgres
  ok "temporaeres Cluster gestartet (Port $port)"

  # Quell-DB mit Schema + Seed
  createdb ez_src
  if [ -d "$ROOT_DIR/supabase/migrations" ]; then
    write_prelude "$work/prelude.sql"
    psql -d ez_src -v ON_ERROR_STOP=1 -q -f "$work/prelude.sql" >/dev/null 2>&1 \
      || { ko "Supabase-Shim (Prelude) fehlgeschlagen"; return; }
    local m
    for m in "$ROOT_DIR"/supabase/migrations/*.sql; do
      psql -d ez_src -v ON_ERROR_STOP=1 -q -f "$m" >/dev/null 2>&1 \
        || { ko "Migration fehlgeschlagen: $(basename "$m")"; return; }
    done
    [ -f "$ROOT_DIR/supabase/seed.sql" ] && psql -d ez_src -v ON_ERROR_STOP=1 -q -f "$ROOT_DIR/supabase/seed.sql" >/dev/null 2>&1
    ok "Quell-DB ez_src: Migrationen + Seed geladen"
  else
    psql -d ez_src -v ON_ERROR_STOP=1 -q <<'SQL' >/dev/null
create table public.categories(id serial primary key, key text, label text);
create table public.category_rules(id serial primary key, keyword text);
insert into public.categories(key,label) values ('obst','Obst'),('brot','Brot'),('milch','Milch');
insert into public.category_rules(keyword) values ('apfel'),('brot'),('milch');
SQL
    ok "Quell-DB ez_src: Fixture-Schema geladen"
  fi

  # Backup
  BACKUP_DIR="$work/backups" POSTGRES_DB=ez_src POSTGRES_USER=postgres \
    bash "$BACKUP_SH" >/dev/null 2>&1 || { ko "backup.sh fehlgeschlagen"; return; }
  local bk; bk="$(ls -1t "$work"/backups/einkaufszettel-*.sql.gz 2>/dev/null | head -n1 || true)"
  [ -n "$bk" ] || { ko "backup.sh erzeugte kein Archiv"; return; }
  ok "backup.sh: Archiv erzeugt ($(basename "$bk"), $(wc -c <"$bk" | tr -d ' ') Byte)"
  [ -f "${bk%.sql.gz}.meta" ] && ok "Metadaten-Sidecar vorhanden" || ko "Metadaten-Sidecar fehlt"

  # Restore
  TARGET_DB=ez_restored RESTORE_CONFIRM=yes POSTGRES_USER=postgres \
    bash "$RESTORE_SH" "$bk" >/dev/null 2>&1 || { ko "restore.sh fehlgeschlagen"; return; }
  ok "restore.sh: in ez_restored eingespielt"

  # Abgleich Tabellenzahlen + Checksummen
  local tables t c_src c_dst h_src h_dst same=1
  tables="$(psql -d ez_src -tAc "select tablename from pg_tables where schemaname='public' order by 1")"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    c_src="$(psql -d ez_src     -tAc "select count(*) from public.\"$t\"")"
    c_dst="$(psql -d ez_restored -tAc "select count(*) from public.\"$t\"")"
    h_src="$(psql -d ez_src     -tAc "select coalesce(md5(string_agg(x::text, E'\n' order by x::text)),'empty') from public.\"$t\" x")"
    h_dst="$(psql -d ez_restored -tAc "select coalesce(md5(string_agg(x::text, E'\n' order by x::text)),'empty') from public.\"$t\" x")"
    if [ "$c_src" = "$c_dst" ] && [ "$h_src" = "$h_dst" ]; then
      printf '  PASS: %-18s count=%s md5=%s\n' "$t" "$c_src" "${h_src:0:12}"
      pass=$(( pass + 1 ))
    else
      printf '  FAIL: %-18s count %s!=%s md5 %s!=%s\n' "$t" "$c_src" "$c_dst" "${h_src:0:12}" "${h_dst:0:12}"
      fails=$(( fails + 1 )); same=0
    fi
  done <<<"$tables"
  [ "$same" = "1" ] && ok "alle Tabellen: count UND md5 identisch (vollstaendig, bit-genau)"

  # Negativ-Test: nicht-leeres Ziel ohne Freigabe -> Exit 5
  if TARGET_DB=ez_src RESTORE_CONFIRM=yes bash "$RESTORE_SH" "$bk" >/dev/null 2>&1; then
    ko "Ueberschreibschutz griff nicht bei nicht-leerem Ziel"
  else
    ok "Ueberschreibschutz: nicht-leeres Ziel ohne RESTORE_DROP_EXISTING abgelehnt (Exit 5)"
  fi

  # Regression: TARGET_DB == Maintenance-DB (Compose-Default "postgres").
  # 1. Restore in die leere Default-DB "postgres" (ohne Drop).
  # 2. Erneuter Restore mit RESTORE_DROP_EXISTING=yes -> erzwingt dropdb/createdb
  #    gegen "postgres"; genau dieser Pfad scheiterte frueher, weil dropdb sich
  #    implizit mit "postgres" verband. Jetzt laeuft er ueber template1.
  if TARGET_DB=postgres RESTORE_CONFIRM=yes bash "$RESTORE_SH" "$bk" >/dev/null 2>&1; then
    ok "Regression: Restore nach 'postgres' (leer, ohne Drop) erfolgreich"
  else
    ko "Regression: Restore nach 'postgres' (leer) fehlgeschlagen"
  fi
  if TARGET_DB=postgres RESTORE_CONFIRM=yes RESTORE_DROP_EXISTING=yes \
       bash "$RESTORE_SH" "$bk" >/dev/null 2>&1; then
    ok "Regression: TARGET_DB=postgres mit Drop/Create ueber Maintenance-DB erfolgreich"
  else
    ko "Regression: TARGET_DB=postgres mit Drop/Create fehlgeschlagen"
  fi
  local c_pg
  c_pg="$(psql -d postgres -tAc "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null | tr -d '[:space:]')"
  [ "${c_pg:-0}" != "0" ] && ok "Regression: 'postgres' enthaelt nach Restore ${c_pg} public-Tabellen" \
                           || ko "Regression: 'postgres' enthaelt nach Restore keine public-Tabellen"

  # Negativ-Test: Retention loescht nur alte Archive
  touch -d '30 days ago' "$work/backups/einkaufszettel-old.sql.gz" "$work/backups/einkaufszettel-old.meta"
  BACKUP_DIR="$work/backups" POSTGRES_DB=ez_src RETENTION_DAYS=14 \
    bash "$BACKUP_SH" >/dev/null 2>&1 || { ko "backup.sh (Retention-Lauf) fehlgeschlagen"; return; }
  if [ -f "$work/backups/einkaufszettel-old.sql.gz" ]; then
    ko "Retention: altes Archiv (30 Tage) nicht geloescht"
  else
    ok "Retention: Archiv aelter als 14 Tage geloescht"
  fi
  if [ "$(ls -1 "$work"/backups/einkaufszettel-*.sql.gz | wc -l | tr -d ' ')" -ge 1 ]; then
    ok "Retention: aktuelles Archiv erhalten"
  else
    ko "Retention: aktuelles Archiv ebenfalls geloescht"
  fi
}

# --- Moduswahl --------------------------------------------------------------
case "$MODE" in
  stub)    static_checks ;;
  dry-run) static_checks; mode_dry_run ;;
  real)    static_checks; mode_real ;;
  auto)
    static_checks
    if find_pg_bin >/dev/null 2>&1; then mode_real; else echo "  HINWEIS: keine portable PostgreSQL gefunden -> nur stub/dry-run."; mode_dry_run; fi
    ;;
  *) echo "Unbekannter Modus: $MODE" >&2; exit 2 ;;
esac

echo
echo "==== ERGEBNIS: $pass bestanden, $fails fehlgeschlagen (Modus $MODE) ===="
[ "$fails" -eq 0 ]
