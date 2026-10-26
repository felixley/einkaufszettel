#!/usr/bin/env bash
# =============================================================================
# check-cert-expiry.sh — Ablaufdatum eines TLS-Zertifikats pruefen (T5.4).
#
# Fuer Monitoring/Alerting: liefert einen Exit-Code, den Uptime Kuma, ein
# Cron-Job oder ein systemd-Timer auswerten kann.
#
# Aufruf (eine der drei Quellen):
#   ./scripts/check-cert-expiry.sh /etc/ssl/fullchain.pem      # Datei
#   ./scripts/check-cert-expiry.sh einkaufszettel.example:443  # Live-Endpoint
#   CERT_FILE=... ./scripts/check-cert-expiry.sh               # via Env
#
# Relevante Env-Variablen:
#   CERT_WARN_DAYS  Schwelle in Tagen (Default: 14)
#   CERT_FILE       Pfad zu einem PEM-Zertifikat
#   CERT_HOST       Hostname fuer einen Live-Abruf
#   CERT_PORT       Port fuer den Live-Abruf (Default: 443)
#   CERT_GLOB       Glob auf Zertifikatsdateien (z. B. Caddy-Volume)
#
# Exit-Codes:
#   0 Zertifikat gueltig, Restlaufzeit > Schwelle
#   1 Zertifikat gueltig, Restlaufzeit <= Schwelle  (Alarm!)
#   2 Fehler (kein Zertifikat lesbar / abgelaufen unlesbar)
#   3 Zertifikat bereits abgelaufen
# =============================================================================
set -euo pipefail

CERT_WARN_DAYS="${CERT_WARN_DAYS:-14}"
CERT_PORT="${CERT_PORT:-443}"
QUIET="${QUIET:-0}"

src_arg="${1:-}"

emit() { [ "$QUIET" = "1" ] || printf '%s\n' "$*"; }
err()  { printf '%s\n' "$*" >&2; }

# --- Zertifikat beschaffen ---------------------------------------------------
pem=""
source_desc=""
if [ -n "$src_arg" ]; then
  case "$src_arg" in
    *:*)
      host="${src_arg%:*}"; port="${src_arg##*:}"
      source_desc="tls://$host:$port"
      pem="$(openssl s_client -servername "$host" -connect "$host:$port" </dev/null 2>/dev/null | openssl x509 2>/dev/null || true)"
      ;;
    *)
      [ -f "$src_arg" ] || { err "FEHLER: Datei nicht gefunden: $src_arg"; exit 2; }
      source_desc="$src_arg"
      pem="$(cat -- "$src_arg")"
      ;;
  esac
elif [ -n "${CERT_FILE:-}" ]; then
  [ -f "$CERT_FILE" ] || { err "FEHLER: Datei nicht gefunden: $CERT_FILE"; exit 2; }
  source_desc="$CERT_FILE"
  pem="$(cat -- "$CERT_FILE")"
elif [ -n "${CERT_HOST:-}" ]; then
  source_desc="tls://$CERT_HOST:$CERT_PORT"
  pem="$(openssl s_client -servername "$CERT_HOST" -connect "$CERT_HOST:$CERT_PORT" </dev/null 2>/dev/null | openssl x509 2>/dev/null || true)"
elif [ -n "${CERT_GLOB:-}" ]; then
  # shellcheck disable=SC2086
  first="$(ls -1 $CERT_GLOB 2>/dev/null | head -n1 || true)"
  [ -n "$first" ] || { err "FEHLER: CERT_GLOB trifft keine Datei: $CERT_GLOB"; exit 2; }
  source_desc="$first"
  pem="$(cat -- "$first")"
else
  err "FEHLER: keine Quelle. Datei/Host als Argument oder CERT_FILE/CERT_HOST/CERT_GLOB setzen."
  exit 2
fi

[ -n "$pem" ] || { err "FEHLER: kein Zertifikat aus '$source_desc' gelesen."; exit 2; }

# --- Auswerten ---------------------------------------------------------------
enddate="$(printf '%s' "$pem" | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
subject="$(printf '%s' "$pem" | openssl x509 -noout -subject 2>/dev/null | sed 's/^subject=//' || true)"
[ -n "$enddate" ] || { err "FEHLER: Ablaufdatum nicht lesbar (kein gueltiges X.509?)."; exit 2; }

end_epoch="$(date -d "$enddate" +%s 2>/dev/null || true)"
[ -n "$end_epoch" ] || { err "FEHLER: Ablaufdatum nicht parsebar: $enddate"; exit 2; }
now="$(date +%s)"
diff=$(( end_epoch - now ))
# Restlaufzeit in vollen Tagen (aufgerundet fuer Alarmzwecke)
days=$(( (diff + 86399) / 86400 ))

if [ "$diff" -lt 0 ]; then
  emit "ABGELAUFEN: $subject ist am $enddate abgelaufen (seit $(( -diff / 86400 )) Tagen)."
  exit 3
fi

if [ "$days" -le "$CERT_WARN_DAYS" ]; then
  emit "WARN: $subject laeuft am $enddate ab — nur noch ${days} Tage (Schwelle ${CERT_WARN_DAYS})."
  exit 1
fi

emit "OK: $subject gueltig bis $enddate — noch ${days} Tage (Schwelle ${CERT_WARN_DAYS})."
exit 0
