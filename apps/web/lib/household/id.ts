/**
 * UUIDv7 fuer clientseitig erzeugte IDs (PLAN.md §4.1).
 *
 * Bewusst lokal in `lib/household`, damit Einladungs-/Mitglieder-UI nicht von
 * der (parallel entstehenden) Dexie-Schicht abhaengt. Aufbau wie
 * `lib/db/uuid.ts`: 48 Bit Zeitstempel | Version 7 | 12 Bit Zufall |
 * Variante 10 | 62 Bit Zufall. Zeitlich sortierbar, ohne Server-Uhr.
 */
export function uuidv7(): string {
  const timestamp = Date.now().toString(16).padStart(12, '0').slice(-12);
  const random = crypto.getRandomValues(new Uint8Array(10));
  let hex = '';
  for (const byte of random) hex += byte.toString(16).padStart(2, '0');

  const timeLow = timestamp.slice(0, 8);
  const timeMid = timestamp.slice(8, 12);
  const randA = hex.slice(0, 3);
  const variant = ((Number.parseInt(hex.slice(3, 5), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, '0');
  const randB = hex.slice(5, 17);

  return `${timeLow}-${timeMid}-7${randA}-${variant}${randB.slice(0, 2)}-${randB.slice(2)}`;
}
