# Security-Baseline (T5.3b)

Stand: 2026-10-26. Geltungsbereich: Caddy als einziger oeffentlicher Eingang
(HTTPS), Security-Header, Rate-Limits und Dependency-Audit. App-Code und
Supabase-Migrationen bleiben unveraendert.

## Sandbox-Grenze

In dieser Sandbox gibt es keinen Docker-Daemon und kein `caddy`-Binary.
Deshalb sind `caddy validate`, der xcaddy-Build und echte Header-/429-Laeufe
hier **nicht** ausfuehrbar. Der Sandbox-Nachweis ist die statische Pruefung
durch `node scripts/check-security-config.mjs`; der Rest ist als offener
Docker-Host-Nachweis markiert (analog D14/T1.3).

## Header

| Header                      | Wert                                                                               | Begruendung                                                                                                                                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`                                              | Ein Jahr HSTS fuer die Domain und ihre Subdomains. `preload` ist bewusst **nicht** gesetzt: Die Domain liegt unter `ipv64.net`, einer fremden Eltern-Domain; Preload ist eine einseitige, schwer ruecknehmbare Selbstverpflichtung und erfordert Kontrolle ueber die Eltern-Domain. |
| `Content-Security-Policy`   | siehe unten                                                                        | Verhindert Fremd-Skripte, Framing, Objekt-Einbettung und Formular-Hijacking.                                                                                                                                                                                                        |
| `X-Frame-Options`           | `DENY`                                                                             | Schutz vor Clickjacking fuer alte Browser, die `frame-ancestors` ignorieren.                                                                                                                                                                                                        |
| `X-Content-Type-Options`    | `nosniff`                                                                          | Verhindert MIME-Sniffing.                                                                                                                                                                                                                                                           |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                  | Volle URL nur same-origin, cross-origin nur der Origin.                                                                                                                                                                                                                             |
| `Permissions-Policy`        | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()` | Die App braucht keine dieser Browser-Faehigkeiten. Kamera ist derzeit nicht noetig; QR-Codes werden nur erzeugt, nicht gescannt.                                                                                                                                                    |
| `Server`                    | entfernt (`-Server`)                                                               | Reduziert Fingerprinting.                                                                                                                                                                                                                                                           |

Die Header werden im Caddyfile auf Site-Ebene gesetzt und gelten damit auch
fuer Fehler- und Redirect-Antworten.

## CSP und die bewusste `unsafe-inline`-Lockerung

Gesetzte Direktiven:

```text
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self';
worker-src 'self' blob:;
manifest-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests
```

Warum `script-src 'unsafe-inline'`?

- Next.js injiziert beim Streaming/RSC Inline-Skripte (Flight-Daten), deren
  Inhalt pro Request variiert. Ein statischer Hash ist damit nicht moeglich.
- `ThemeScript` setzt das Theme vor dem ersten Paint als Inline-Skript, damit
  es beim Laden nicht hell/dunkel flackert (T4.4).
- Eine Nonce-Loesung wuerde einen Eingriff in die App (Middleware/Response-
  Header pro Request) erfordern. Der Auftrag erlaubt nur Header-Aenderungen am
  Rand, keine App-Verhaltensaenderung. Deshalb die pragmatische, dokumentierte
  Lockerung.
- `unsafe-eval` ist **nicht** erlaubt. `object-src`, `base-uri`,
  `frame-ancestors` und `form-action` bleiben strikt.

Warum `style-src 'unsafe-inline'`? Next.js und die vorhandenen CSS-Module
setzen Inline-Styles/`style`-Attribute (u. a. Theme-Umschaltung, Layout-
Offsets). Ohne `unsafe-inline` brechen diese Styles.

Warum `img-src data: blob:` und `worker-src blob:`? PWA-Icons/Manifest und der
Service Worker (`/sw.js`) nutzen Daten- und Blob-URLs; `worker-src 'self'`
allein wuerde den registrierten Worker nicht abdecken.

Warum `connect-src 'self'`? Im Betrieb werden GoTrue (`/auth/v1/*`) und
PostgREST (`/rest/v1/*`) ueber denselben Caddy-Origin proxied. Es gibt keine
Cross-Origin-Aufrufe. Sollte spaeter ein externer Supabase-Host genutzt werden,
muss dessen Origin explizit ergaenzt werden.

**E2E-Vertraeglichkeit:** Die Header greifen nur hinter Caddy. Playwright/E2E
laufen gegen den Next.js-Server ohne Caddy und sehen die CSP daher nicht. Die
Chromium-Suite wird durch diese Aenderung nicht beeinflusst.

## Rate-Limits

Plugin: `github.com/mholt/caddy-ratelimit@v0.1.0` (per xcaddy in
`caddy/Dockerfile` gepinnt). Das Plugin ist upstream als „WORK IN PROGRESS"
markiert; v0.1.0 ist das letzte verfuegbare Tag. Risiko: Verhalten/Build-
Kompatibilitaet mit Caddy 2.11.7 ist hier nicht ausfuehrbar und muss auf dem
Docker-Host per `caddy validate` und einem 429-Test bestaetigt werden.

| Zone             | Pfad                                                              | Limit                                | Begruendung                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth_ip`        | `/auth/v1/*`                                                      | 20 Ereignisse / 1 Minute / Client-IP | Login, Token-Refresh und Passwort-Reset. 20/min erlaubt normalen Haushaltsbetrieb, bremst aber Credential-Stuffing deutlich. GoTrue hat zusaetzlich eigene Schutzmechanismen. |
| `add_to_list_ip` | `/rest/v1/rpc/add_to_list`                                        | 60 Ereignisse / 1 Minute / Client-IP | Haeufigster Schreib-RPC. 60/min deckt schnelles Eintragen mehrerer Artikel ab, verhindert aber automatisierte Fluten.                                                         |
| `invite_ip`      | `create_invite`, `accept_invite`, `check_invite`, `revoke_invite` | 10 Ereignisse / 1 Minute / Client-IP | Einladungen sind selten und missbrauchsanfaellig (Enumeration/Brute-Force von Tokens).                                                                                        |

Schluessel ist `{remote_host}` (Client-IP). Caddy steht direkt am Edge; es ist
kein vertrauenswuerdiger Upstream-Proxy vorgeschaltet. Bei mehreren Haushalten
hinter einer NAT-IP teilen sie sich das Limit; die Werte sind deshalb bewusst
grosszuegig und koennen nach Messung im Betrieb angepasst werden. Bei
Limitueberschreitung antwortet das Plugin mit HTTP 429 und `Retry-After`.

Nicht abgedeckt: globale Limits fuer alle RPCs oder per JWT-Nutzer. Das waere
erst mit einem Plugin sinnvoll, das Authorization-Header auswertet; der
aktuelle Schutz ist IP-basiert und wird in `docs/SECURITY.md` so dokumentiert.

## Dependency-Audit

Ausgefuehrt am 2026-10-26 mit npm 12.0.2 (Node v26.7.0). Das Repo nutzt pnpm
und hat kein `package-lock.json`; fuer den von der Aufgabe geforderten
`npm audit --omit=dev`-Lauf wurde deshalb in einem temporaeren Verzeichnis
(`/opt/data/profiles/devops/cache/scratch/npm-audit`) ein reines
Production-Paket aus den `apps/web`-Dependencies ohne den Workspace-Paket-
Verweis erzeugt, mit `npm install --package-lock-only --omit=dev` aufgeloest
und dort auditiert. Das ist derselbe Production-Abhaengigkeitsgraph, den
`apps/web` zur Laufzeit bundelt; `@einkaufszettel/core` hat keine eigenen
Runtime-Dependencies.

Kommando:

```bash
npm install --package-lock-only --omit=dev --ignore-scripts --no-audit --no-fund
npm audit --omit=dev --json
```

Ergebnis (Exitcode 0, keine Advisories):

```json
{
  "vulnerabilities": {
    "info": 0,
    "low": 0,
    "moderate": 0,
    "high": 0,
    "critical": 0,
    "total": 0
  },
  "dependencies": {
    "prod": 58,
    "dev": 0,
    "optional": 39,
    "peer": 0,
    "peerOptional": 0,
    "total": 96
  }
}
```

Risikobewertung: **0 bekannte Schwachstellen** in den Production-Dependencies
zum Audit-Zeitpunkt. Es gibt keine begruendete Ausnahme. Cross-Check mit
`npx pnpm@9.15.4 audit --prod --json` gegen den echten `pnpm-lock.yaml`:
0 Vulnerabilities bei 104 Production-Dependencies. Der Audit ist eine
Momentaufnahme; neue CVEs nach dem Audit sind moeglich. Empfehlung fuer den
Betrieb: `pnpm audit --prod` woechentlich bzw. bei jedem Dependency-Update
ausfuehren. Eine automatische CI-Stufe ist nicht Teil von T5.3b (Netzwerk-
Abhaengigkeit und Flakiness); der Security-Config-Check laeuft dafuer in CI.

## Pruefung auf dem Docker-Host (offen)

1. Build und Start:

   ```bash
   docker compose build caddy
   docker compose up -d caddy
   ```

2. Caddy-Konfiguration validieren (der Healthcheck macht dasselbe):

   ```bash
   docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
   ```

   Erwartung: `Valid configuration`. Schlaegt der xcaddy-Build mit Caddy
   2.11.7 fehl, ist das dokumentierte Fallback in `caddy/README.md`
   (Variante B) zu pruefen; alternativ Plugin-Version anheben und erneut
   pinnen.

3. Header pruefen:

   ```bash
   curl -sSI "https://${DOMAIN}" | grep -Ei \
     'strict-transport-security|content-security-policy|x-frame-options|x-content-type-options|referrer-policy|permissions-policy|^server:'
   ```

   Erwartung: alle sechs Header vorhanden, kein `Server`-Header. `curl -I`
   sendet HEAD; Caddy liefert die Header auch dort.

4. Rate-Limit pruefen (Login-Zone, 25 Anfragen):

   ```bash
   for i in $(seq 1 25); do
     curl -s -o /dev/null -w "%{http_code}\n" -X POST \
       "https://${DOMAIN}/auth/v1/token?grant_type=password" \
       -H 'Content-Type: application/json' \
       -d '{"email":"nobody@example.com","password":"wrong-password"}'
   done | sort | uniq -c
   ```

   Erwartung: Die ersten 20 Anfragen erreichen GoTrue (Antwort 400), ab der 21. antwortet Caddy mit 429. Die genauen Zaehler haengen von bereits
   erfolgten Anfragen derselben IP im aktuellen Fenster ab; fuer einen
   sauberen Test vorher einige Minuten warten oder den Caddy-Container neu
   starten (Rate-Limit-Zustand liegt im Speicher).

5. HSTS-/Preload-Entscheidung: `includeSubDomains` ist aktiv, `preload` nicht.
   Eine Aufnahme in die Browser-Preload-Liste ist nicht vorgesehen und waere
   nur mit Kontrolle ueber `ipv64.net` sowie bewusster Freigabe sinnvoll.

## Offene Punkte

- xcaddy-Build mit `caddy-ratelimit@v0.1.0` gegen Caddy 2.11.7 auf einem
  Docker-Host verifizieren (`caddy validate`, Header- und 429-Test).
- Echte Header-/Rate-Limit-Laeufe hinter Caddy sind in der Sandbox nicht
  moeglich; die statische Pruefung deckt nur die Konfiguration ab.
- Rate-Limit-Werte nach realer Messung (Haushaltsgroesse, NAT-Situation)
  nachjustieren.
