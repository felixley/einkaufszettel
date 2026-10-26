# Variante A: Caddy mit lego-deprecated-DNS-Provider (ipv64) per xcaddy.
# Module sind auf feste Versionen gepinnt: lego-deprecated auf einen Commit
# (keine Releases mehr), caddy-ratelimit auf das letzte Tag v0.1.0.
# Caddy selbst ist auf v2.11.7 gepinnt, damit der Build reproduzierbar bleibt.
FROM caddy:2.11.7-builder AS builder

RUN xcaddy build v2.11.7 \
    --with github.com/caddy-dns/lego-deprecated@v0.0.0-20221129224906-9187923c0cf9 \
    --with github.com/mholt/caddy-ratelimit@v0.1.0

FROM caddy:2.11.7

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY caddy/Caddyfile /etc/caddy/Caddyfile

EXPOSE 443
