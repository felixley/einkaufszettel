# perf/ – Lasttests

Lasttests für den Einkaufszettel-Sync-Stack. Aktuell:

- `k6-sync.js` – k6-Szenario für **10 Haushalte × 5 Nutzer (50 VUs)** gegen den
  Mock-Sync-Stack. Deckt den Outbox-Pfad (Polling + Upsert) und die
  `add_to_list`-RPC inkl. `request_id`-Idempotenz ab.

Die Messwerte und die Interpretation stehen in [`../docs/PERF.md`](../docs/PERF.md).

## Voraussetzungen

1. **k6** (>= 0.49; getestet mit v2.3.0). Installation z. B.:
   - Debian/Ubuntu: `sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69 && echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list && sudo apt-get update && sudo apt-get install k6`
   - Binary (ohne root): `curl -sSL https://github.com/grafana/k6/releases/download/v2.3.0/k6-v2.3.0-linux-amd64.tar.gz | tar xz` →
     `./k6-v2.3.0-linux-amd64/k6`.
2. **Mock-Sync-Stack läuft**: entweder `next dev` oder ein Produktions-Build
   (`next build && next start`) mit `NEXT_PUBLIC_AUTH_MOCK=true`.
   Ohne gesetzte Supabase-URL ist der Mock automatisch aktiv.

> Für belastbare Zahlen immer gegen den **Produktions-Build** (`next start`)
> messen. Der Turbopack-Dev-Server ist im Sync-Pfad ~12× langsamer (siehe
> `docs/PERF.md`).

## Ausführen

```bash
# Server starten (im Repo-Root)
cd apps/web && NEXT_PUBLIC_AUTH_MOCK=true next build
# Produktions-Build starten (output: standalone) – kanonisch:
PORT=3102 HOSTNAME=127.0.0.1 NEXT_PUBLIC_AUTH_MOCK=true node .next/standalone/apps/web/server.js
# (funktioniert auch: NEXT_PUBLIC_AUTH_MOCK=true next start -p 3102)

# Lasttest (k6 auf dem PATH oder Pfad zum Binary angeben)
k6 run -e BASE_URL=http://localhost:3102 perf/k6-sync.js
```

Optionale Parameter (Umgebungsvariablen):

| Variable   | Default                 | Bedeutung                          |
| ---------- | ----------------------- | ---------------------------------- |
| `BASE_URL` | `http://localhost:3000` | Basis-URL des laufenden Servers    |
| `SYNC_VUS` | `30`                    | Peak-VUs im Szenario `sync_outbox` |
| `ADD_VUS`  | `20`                    | Peak-VUs im Szenario `add_to_list` |
| `HOLD`     | `60s`                   | Dauer der Lastphase je Szenario    |

`SYNC_VUS + ADD_VUS` ergibt die Gesamtzahl gleichzeitiger VUs (Default: 50).

Maschinenlesbares Ergebnis mitschreiben:

```bash
k6 run -e BASE_URL=http://localhost:3102 \
  --summary-export=perf/results/summary.json perf/k6-sync.js
```

## Szenario-Aufbau

| Szenario      | Exec-Funktion    | Last                                    | Lastprofil (Default)                      |
| ------------- | ---------------- | --------------------------------------- | ----------------------------------------- |
| `sync_outbox` | `syncOutboxFlow` | Outbox-Pfad: GET-Polling + POST-Upsert  | 0→30 VUs (20 s), 30 VUs (60 s), →0 (10 s) |
| `add_to_list` | `addToListFlow`  | `add_to_list`-RPC + `request_id`-Replay | 0→20 VUs (20 s), 20 VUs (60 s), →0 (10 s) |

Die **VU→Haushalt/Sitz-Zuordnung** ist deterministisch: VU `n` gehört zu
Haushalt `((n-1) mod 10) + 1` und Sitz `floor((n-1)/10)` — also exakt 10
Haushalte × 5 Sitze über die 50 VUs.

## Schwellenwerte

- `http_req_duration{p(95)} < 1000 ms` (auch getaggt je Szenario)
- `http_req_failed < 1 %`
- `checks > 99 %`
- `add_to_list_idempotency_ok > 99 %` (Replay darf nie doppelt aufaddieren)
