/**
 * Waehlt den Auth-Modus. Gleiche Logik in Middleware (Server/Edge) und Client.
 *
 * - NEXT_PUBLIC_AUTH_MOCK=true  -> immer Mock
 * - NEXT_PUBLIC_AUTH_MOCK=false -> immer Supabase (Fehler, falls Env fehlt)
 * - unset                       -> Mock, wenn keine Supabase-URL/Anon-Key gesetzt ist
 */
export function isMockAuth(): boolean {
  const flag = process.env.NEXT_PUBLIC_AUTH_MOCK;
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}
