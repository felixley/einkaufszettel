# Variante A: Caddy mit lego-deprecated-DNS-Provider (ipv64) per xcaddy.
# Modul ist ein Uebergangs-Shim und auf einen Commit gepinnt, weil das Repo
# keine Releases mehr veroeffentlicht.
FROM caddy:2.11.7-builder AS builder

RUN xcaddy build \
    --with github.com/caddy-dns/lego-deprecated@v0.0.0-20221129224906-9187923c0cf9

FROM caddy:2.11.7

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY caddy/Caddyfile /etc/caddy/Caddyfile

EXPOSE 443
