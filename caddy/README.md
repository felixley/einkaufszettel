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
