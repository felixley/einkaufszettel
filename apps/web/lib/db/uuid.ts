/**
 * UUIDv7 für clientseitig erzeugte IDs (PLAN.md §4.1).
 *
 * Aufbau: 48 Bit Unix-Millisekunden | 4 Bit Version (7) | 12 Bit Zufall |
 * 2 Bit Variante (10) | 62 Bit Zufall. Dadurch sind IDs zeitlich sortierbar,
 * ohne dass der Client eine Server-Uhr braucht.
 *
 * Hex-Layout (8-4-4-4-12): timeLow | timeMid | 7 + randA | variante + randB |
 * restlicher Zufall. Die vierte Gruppe beginnt mit genau einer Hex-Ziffer der
 * Variante (10xx), danach folgen drei Zufalls-Hexziffern.
 */
export function uuidv7(): string {
  const timestamp = Date.now().toString(16).padStart(12, '0').slice(-12);
  const random = crypto.getRandomValues(new Uint8Array(10));
  let hex = '';
  for (const byte of random) hex += byte.toString(16).padStart(2, '0');

  const timeLow = timestamp.slice(0, 8);
  const timeMid = timestamp.slice(8, 12);
  const randA = hex.slice(0, 3);
  const variant = ((Number.parseInt(hex.slice(3, 4), 16) & 0x3) | 0x8).toString(16);
  const randB = hex.slice(4, 7);
  const randC = hex.slice(7, 19);

  return `${timeLow}-${timeMid}-7${randA}-${variant}${randB}-${randC}`;
}
