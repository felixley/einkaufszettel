# Entscheidungen

Format je Eintrag: Datum, Entscheidung, Begründung, Alternative, Risiko/Status.

## 2026-10-25 — HTTPS/TLS: Caddy Variante A (xcaddy + lego-deprecated)

- **Entscheidung:** Caddy wird als eigenes Image per `xcaddy build` mit
  `github.com/caddy-dns/lego-deprecated` gebaut; die DNS-01-Challenge läuft
  gegen ipv64.net (`tls { dns lego_deprecated ipv64 }`). Modulstand ist auf
  Commit `9187923c0cf983e9bc9db5fad5b6569994b190d6` gepinnt.
- **Begründung:** In `PLAN.md` §5 (T1.3) ist Variante A bevorzugt. DNS-01
  erlaubt gültige Zertifikate ohne öffentlich erreichbaren Port 80/443; der
  Betrieb kann auf LAN/VPN beschränkt bleiben. Ein einzelner Caddy-Container
  statt Caddy + lego + Cert-Volume reduziert bewegliche Teile.
- **Alternative:** Variante B — `lego`-Container erneuert per Cron
  (`--dns ipv64`) und Caddy bindet `/certs/fullchain.pem` + `key.pem` ein.
  Nur Fallback, falls der xcaddy-Build mit Caddy 2.11.7 bricht. Wechsel
  betrifft nur den Caddy-Service (Image/Caddyfile) plus lego-Service.
- **Risiko/Status:** `lego-deprecated` ist ein Übergangs-Shim ohne Releases
  (letzter Commit 2022); der Build ist in dieser Sandbox ohne Docker-Daemon
  nicht ausführbar. Verifikation auf Docker-Host offen. Offene Frage an PO:
  konkreter DNS-Name und Ziel-IP (öffentlich vs. privat).
