/**
 * Tooling-Smoke, kein Produktcode.
 *
 * Existiert nur, damit TypeScript/Lint/Vitest auf einem frischen Checkout
 * (noch ohne Anwendungscode) eine echte Eingabe haben. Wird ersetzt, sobald
 * die ersten Pakete echten Code enthalten.
 */
export const TOOLING_SMOKE = 'tooling-smoke-ok' as const;

export function toolingSmoke(): string {
  return TOOLING_SMOKE;
}
