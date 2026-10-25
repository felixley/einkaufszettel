#!/usr/bin/env node
/**
 * Erzeugt JWT_SECRET, ANON_KEY und SERVICE_ROLE_KEY fuer den lokalen
 * Supabase-Stack (HS256, Rollen anon/service_role).
 *
 * Aufruf:
 *   cp .env.example .env
 *   node scripts/generate-supabase-keys.mjs | tee -a .env
 *
 * Das Skript ueberschreibt keine Datei; es schreibt nur auf stdout.
 * Bereits gesetztes JWT_SECRET (z. B. in .env) wird uebernommen, damit
 * ANON_KEY/SERVICE_ROLE_KEY dazu passen.
 */
import { createHmac, randomBytes } from 'node:crypto';

const secret = process.env.JWT_SECRET ?? randomBytes(32).toString('hex');
const header = { alg: 'HS256', typ: 'JWT' };
const iat = Math.floor(Date.now() / 1000);
const exp = iat + 60 * 60 * 24 * 365 * 10;

function sign(payload) {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

const anonKey = sign({ role: 'anon', iss: 'supabase', iat, exp });
const serviceRoleKey = sign({ role: 'service_role', iss: 'supabase', iat, exp });

console.log(`JWT_SECRET=${secret}`);
console.log(`ANON_KEY=${anonKey}`);
console.log(`SERVICE_ROLE_KEY=${serviceRoleKey}`);
