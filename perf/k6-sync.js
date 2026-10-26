/* eslint-disable */
// k6-Lasttest für den Mock-Sync-Stack (PLAN.md §T5.2).
//
// Modelliert 10 Haushalte × 5 gleichzeitige Nutzer = 50 VUs. Zwei Szenarien
// teilen sich die 50 VUs (30 „Sync/Outbox“ + 20 „add_to_list“):
//   1. sync_outbox  – Outbox-Pfad: Polling (GET ?since=cursor) + Upsert (POST).
//   2. add_to_list  – serverseitige add_to_list-RPC inkl. request_id-Replay.
//
// Die VU→Haushalt/Sitz-Zuordnung ist deterministisch: VU 1..50 werden in
// 10 Haushalte × 5 Sitze aufgeteilt (__VU ist pro Lauf global eindeutig).
//
// Ausführen (siehe perf/README.md):
//   k6 run -e BASE_URL=http://localhost:3210 perf/k6-sync.js
//
// Optionale Envs:
//   BASE_URL        Basis-URL des Dev-/Prod-Servers (Default http://localhost:3000)
//   SYNC_VUS        Peak-VUs im Sync-Szenario        (Default 30)
//   ADD_VUS         Peak-VUs im add_to_list-Szenario (Default 20)
//   HOLD            Haltedauer der Lastphase         (Default 60s)
//
// Keine externen Importe (kein jslib), keine Runtime-Dependencies.

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const SYNC_URL = `${BASE_URL}/api/mock/sync`;

const HOUSEHOLDS = 10;
const USERS_PER_HOUSEHOLD = 5;
const TOTAL_USERS = HOUSEHOLDS * USERS_PER_HOUSEHOLD; // 50

const SYNC_VUS = Number(__ENV.SYNC_VUS || 30);
const ADD_VUS = Number(__ENV.ADD_VUS || 20);
const HOLD = __ENV.HOLD || '60s';

// Artikelset für add_to_list; Einheiten sind bewusst gemischt (mass/volume/
// piece/unspecified), damit der Core-Aggregator alle Pfade berührt.
const ITEMS = [
  { name: 'Milch', quantity: 1, unit: 'l' },
  { name: 'Mehl', quantity: 500, unit: 'g' },
  { name: 'Tomaten', quantity: 3, unit: 'Stk' },
  { name: 'Nudeln', quantity: 2, unit: 'Packung' },
  { name: 'Olivenöl', quantity: 250, unit: 'ml' },
  { name: 'Salz', quantity: 1, unit: 'Prise' },
  { name: 'Petersilie', quantity: 1, unit: 'Bund' },
  { name: 'Knoblauch', quantity: 2, unit: 'Zehe' },
];

const idempotentReplays = new Counter('add_to_list_idempotent_replays');
const idempotencyOk = new Rate('add_to_list_idempotency_ok');
const pollRows = new Trend('sync_poll_rows', true);
const upsertsApplied = new Counter('sync_upserts_applied');

export const options = {
  scenarios: {
    sync_outbox: {
      executor: 'ramping-vus',
      exec: 'syncOutboxFlow',
      startVUs: 0,
      stages: [
        { duration: '20s', target: SYNC_VUS }, // Ramp-up
        { duration: HOLD, target: SYNC_VUS }, // Lastphase
        { duration: '10s', target: 0 }, // Ramp-down
      ],
      gracefulRampDown: '5s',
      tags: { flow: 'sync' },
    },
    add_to_list: {
      executor: 'ramping-vus',
      exec: 'addToListFlow',
      startVUs: 0,
      stages: [
        { duration: '20s', target: ADD_VUS }, // Ramp-up
        { duration: HOLD, target: ADD_VUS }, // Lastphase
        { duration: '10s', target: 0 }, // Ramp-down
      ],
      gracefulRampDown: '5s',
      tags: { flow: 'add_to_list' },
    },
  },
  thresholds: {
    // Akzeptanzkriterium T5.2: p95 < 1 s, Fehlerrate < 1 %.
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    'http_req_duration{flow:sync}': ['p(95)<1000'],
    'http_req_duration{flow:add_to_list}': ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    // Idempotenz: ein Replay darf nie eine zweite Zeile anlegen.
    add_to_list_idempotency_ok: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

/** Deterministische VU→(Haushalt, Sitz)-Zuordnung: 10 Haushalte × 5 Sitze. */
function householdForVu(vu) {
  const index = (Math.abs(vu) - 1) % TOTAL_USERS;
  const household = (index % HOUSEHOLDS) + 1;
  const seat = Math.floor(index / HOUSEHOLDS);
  const scope = `perf-h${String(household).padStart(2, '0')}`;
  return { scope, seat, household };
}

function postJson(path, body, tags) {
  return http.post(path, JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    tags,
  });
}

function isOk(res) {
  const body = res.json();
  return res.status === 200 && body && body.ok === true;
}

/**
 * Vor dem Lauf: alle Perf-Scopes leeren, damit der In-Memory-Store sauber
 * startet und die Messung nicht von Altbestand verfälscht wird.
 */
export function setup() {
  const scopes = [];
  for (let h = 1; h <= HOUSEHOLDS; h += 1) {
    scopes.push(`perf-h${String(h).padStart(2, '0')}`);
  }
  for (const scope of scopes) {
    http.del(`${SYNC_URL}?scope=${encodeURIComponent(scope)}`, null, {
      tags: { flow: 'setup' },
    });
  }
  // Funktionale Idempotenz-Vorprüfung: gleiche request_id -> duplicate:true.
  const probeScope = 'perf-idempotency-probe';
  http.del(`${SYNC_URL}?scope=${encodeURIComponent(probeScope)}`, null);
  const request = {
    request_id: 'setup-probe-1',
    list_id: 'setup-list',
    name: 'Idempotenz-Probe',
    quantity: 1,
    unit: 'Stk',
  };
  const first = postJson(SYNC_URL, { action: 'add_to_list', scope: probeScope, request }, {});
  const second = postJson(SYNC_URL, { action: 'add_to_list', scope: probeScope, request }, {});
  const firstCreated = first.status === 200 && first.json('data.created') === true;
  const secondDuplicate = second.status === 200 && second.json('data.duplicate') === true;
  if (!firstCreated || !secondDuplicate) {
    throw new Error(
      `Idempotenz-Vorprüfung fehlgeschlagen (created=${firstCreated}, duplicate=${secondDuplicate}). ` +
        `Läuft der Mock-Sync im Mock-Modus?`,
    );
  }
  return { baseUrl: BASE_URL };
}

// Cursor ist pro VU gekapselt (jede VU hat eine eigene JS-Laufzeit).
let cursor = '1970-01-01T00:00:00.000Z';
let requestSeq = 0;

/** Szenario 1: Outbox-Pfad – Polling (GET) + Upsert (POST). */
export function syncOutboxFlow() {
  const { scope } = householdForVu(__VU);

  group('sync_poll', () => {
    const url = `${SYNC_URL}?scope=${encodeURIComponent(scope)}&since=${encodeURIComponent(cursor)}`;
    const res = http.get(url, { tags: { flow: 'sync', op: 'poll' } });
    const ok = check(res, {
      'poll: HTTP 200': (r) => r.status === 200,
      'poll: ok=true': (r) => isOk(r),
    });
    if (ok) {
      const page = res.json('data') || {};
      if (typeof page.cursor === 'string' && page.cursor.length > 0) cursor = page.cursor;
      pollRows.add(Array.isArray(page.rows) ? page.rows.length : 0);
    }
  });

  group('sync_upsert', () => {
    const rowId = `perf-${scope}-vu${__VU}`;
    const row = {
      id: rowId,
      list_id: `list-${scope}`,
      name: 'Lasttest-Artikel',
      name_normalized: 'lasttest-artikel',
      quantity: 1 + (__ITER % 5),
      unit: 'Stk',
      category_id: null,
      checked: __ITER % 2 === 0,
      checked_by: null,
      source_recipe_id: null,
      note: null,
    };
    const res = postJson(
      SYNC_URL,
      {
        action: 'upsert',
        scope,
        table: 'list_items',
        row,
        changed_fields: ['quantity', 'checked'],
      },
      { flow: 'sync', op: 'upsert' },
    );
    const ok = check(res, {
      'upsert: HTTP 200': (r) => r.status === 200,
      'upsert: ok=true': (r) => isOk(r),
    });
    if (ok) upsertsApplied.add(1);
  });

  sleep(0.1 + Math.random() * 0.4);
}

/** Szenario 2: add_to_list-RPC inkl. request_id-Replay (Idempotenz). */
export function addToListFlow() {
  const { scope, seat } = householdForVu(__VU);
  const item = ITEMS[Math.floor(Math.random() * ITEMS.length)];
  requestSeq += 1;
  // Deterministische, pro (Haushalt, Sitz, Iteration) stabile request_id:
  // ein Replay nach Timeout benutzt exakt dieselbe ID.
  const requestId = `perf-req-${scope}-s${seat}-${requestSeq}`;
  const listId = `list-${scope}`;
  const request = {
    request_id: requestId,
    list_id: listId,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
  };
  const payload = { action: 'add_to_list', scope, request };

  const first = postJson(SYNC_URL, payload, { flow: 'add_to_list', op: 'add_to_list' });
  const firstOk = check(first, {
    'add_to_list: HTTP 200': (r) => r.status === 200,
    'add_to_list: ok=true': (r) => isOk(r),
    'add_to_list: affected gesetzt': (r) => r.json('data.affected') !== null,
  });

  // Replay mit gleicher request_id: darf NICHTS erneut aufaddieren.
  if (firstOk) {
    const replay = postJson(SYNC_URL, payload, { flow: 'add_to_list', op: 'add_to_list_replay' });
    const duplicate = replay.status === 200 && replay.json('data.duplicate') === true;
    idempotencyOk.add(duplicate);
    if (duplicate) idempotentReplays.add(1);
    check(replay, {
      'replay: idempotent (duplicate=true)': () => duplicate,
    });
  }

  sleep(0.1 + Math.random() * 0.4);
}
