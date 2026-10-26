# Caddy / HTTPS (T1.3)

## Variante A (umgesetzt, bevorzugt)

`caddy/Dockerfile` baut Caddy per `xcaddy` mit dem DNS-Provider
`github.com/caddy-dns/lego-deprecated`. Im `Caddyfile` wird die
DNS-01-Challenge fuer ipv64.net verwendet:

```caddyfile
tls {
    dns lego_deprecated ipv64
}
```

Voraussetzungen:

- `DOMAIN` zeigt per A-/AAAA-Record auf den Server (privat oder oeffentlich).
- `IPV64_API_KEY` und `ACME_EMAIL` stehen in `.env` (nicht im Repo).
- Fuer die DNS-01-Challenge muss **kein** Port 80/443 von aussen erreichbar
  sein. Fuer den App-Zugriff wird Port 443 veroeffentlicht (`HTTPS_PORT`).

Das Modul ist ein Uebergangs-Shim (seit 2022 kein Release). Wenn der
`xcaddy`-Build mit Caddy 2.11.7 bricht, ist Variante B der dokumentierte
Fallback.

## Variante B (Fallback, nicht umgesetzt)

Ein `lego`-Container erneuert die Zertifikate per Cron (`--dns ipv64`) und
schreibt sie in ein Volume. Caddy bindet sie dann direkt ein:

```caddyfile
tls /certs/fullchain.pem /certs/key.pem
```

Der Wechsel erfordert nur den Austausch des Caddy-Service (Image + Caddyfile)
und einen zusaetzlichen `lego`-Service; die uebrigen Dienste bleiben
unveraendert. Der Renewal-Test ist im README dokumentiert.

## Security-Baseline (T5.3b)

Das Caddyfile setzt Security-Header (CSP, HSTS, X-Frame-Options/frame-ancestors,
Referrer- und Permissions-Policy, nosniff) und Rate-Limit-Zonen fuer
`/auth/v1/*`, `add_to_list` und die Invite-RPCs. Dafuer baut das Dockerfile
zusaetzlich `github.com/mholt/caddy-ratelimit@v0.1.0` ein; Caddy selbst ist auf
`v2.11.7` gepinnt. Begruendung, Limits, CSP-Ausnahmen und die Pruefschritte
auf dem Docker-Host stehen in [`../docs/SECURITY.md`](../docs/SECURITY.md).

Statische Pruefung ohne Docker:

```bash
node scripts/check-security-config.mjs
```

Der Check laeuft auch in der CI (`ci.yml`, Job `quality`).

## Zertifikatsablauf ueberwachen (T5.4)

Caddy erneuert Let's-Encrypt-Zertifikate selbst; ob die Erneuerung wirklich
greift, prueft `scripts/check-cert-expiry.sh` (Exit 1 = laeuft in <= 14 Tagen
ab). Live gegen den veroeffentlichten Port:

```bash
./scripts/check-cert-expiry.sh "${DOMAIN}:443"
```

Ohne externen Portzugriff direkt auf die im Caddy-Volume abgelegten
Zertifikate (Pfad je nach Volume-Namen):

```bash
CERT_GLOB='/var/lib/docker/volumes/einkaufszettel_caddy-data/_data/caddy/certificates/*/*/*.crt' \
  ./scripts/check-cert-expiry.sh
```

Details und Alarmweg: [`docs/OPERATIONS.md`](../docs/OPERATIONS.md) §7/§8.
