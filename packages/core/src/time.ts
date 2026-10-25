import type { IsoTimestamp } from './types.js';

/** Parst einen ISO-8601-Zeitstempel und wirft bei ungültigen Eingaben. */
export function timestampToMillis(timestamp: IsoTimestamp, label = 'timestamp'): number {
  const millis = Date.parse(timestamp);
  if (Number.isNaN(millis)) {
    throw new Error(`Ungültiger Zeitstempel (${label}): ${timestamp}`);
  }
  return millis;
}

/** Vergleicht zwei Zeitstempel; negativ = a älter, 0 = Gleichstand. */
export function compareTimestamps(a: IsoTimestamp, b: IsoTimestamp): number {
  return timestampToMillis(a) - timestampToMillis(b);
}

/** Liefert den jüngsten der übergebenen Zeitstempel. */
export function latestTimestamp(first: IsoTimestamp, ...rest: IsoTimestamp[]): IsoTimestamp {
  let latest = first;
  for (const candidate of rest) {
    if (compareTimestamps(candidate, latest) > 0) latest = candidate;
  }
  return latest;
}
