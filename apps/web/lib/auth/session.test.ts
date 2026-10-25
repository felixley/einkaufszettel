import { describe, expect, it } from 'vitest';
import { base64UrlDecode, base64UrlEncode, decodeMockSession } from './session';

function encodeSession(payload: unknown): string {
  return base64UrlEncode(JSON.stringify(payload));
}

describe('base64Url', () => {
  it('kodiert und dekodiert verlustfrei', () => {
    const raw = 'Einkaufszettel – äöüß';
    expect(base64UrlDecode(base64UrlEncode(raw))).toBe(raw);
  });

  it('erzeugt URL-sichere Zeichen', () => {
    const encoded = base64UrlEncode('???>>>');
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe('decodeMockSession', () => {
  it('liefert eine gueltige Session', () => {
    const session = { sub: 'u1', email: 'a@b.de', exp: Date.now() + 60_000 };
    expect(decodeMockSession(encodeSession(session))).toEqual(session);
  });

  it('lehnt abgelaufene Sessions ab', () => {
    expect(
      decodeMockSession(encodeSession({ sub: 'u1', email: 'a@b.de', exp: Date.now() - 1 })),
    ).toBeNull();
  });

  it('lehnt kaputte Werte ab', () => {
    expect(decodeMockSession('kein-json')).toBeNull();
    expect(decodeMockSession(undefined)).toBeNull();
    expect(decodeMockSession(encodeSession({ sub: 'u1' }))).toBeNull();
  });
});
