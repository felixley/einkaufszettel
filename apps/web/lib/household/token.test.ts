import { describe, expect, it } from 'vitest';
import { buildInviteUrl, generateInviteToken, inviteTokenFromUrl, sha256Hex } from './token';

describe('generateInviteToken', () => {
  it('erzeugt 43 Zeichen base64url (256 Bit)', () => {
    const token = generateInviteToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain('=');
  });

  it('kollidiert nicht bei 200 Ziehungen', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateInviteToken()));
    expect(tokens.size).toBe(200);
  });
});

describe('sha256Hex', () => {
  it('liefert den bekannten Vektor fuer "abc"', async () => {
    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('liefert 64 Hexzeichen und ist deterministisch', async () => {
    const token = generateInviteToken();
    const first = await sha256Hex(token);
    const second = await sha256Hex(token);
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(token);
  });
});

describe('buildInviteUrl / inviteTokenFromUrl', () => {
  it('baut eine absolute URL ohne doppelte Schraegstriche', () => {
    const token = generateInviteToken();
    const url = buildInviteUrl('https://listen.example.org/', token);
    expect(url).toBe(`https://listen.example.org/invite/${token}`);
    expect(inviteTokenFromUrl(url)).toBe(token);
  });

  it('weist fremde Pfade und ungueltige Zeichen ab', () => {
    expect(inviteTokenFromUrl('https://example.org/other/abc')).toBeNull();
    expect(inviteTokenFromUrl('https://example.org/invite/a%20b')).toBeNull();
    expect(inviteTokenFromUrl('kaputt')).toBeNull();
  });
});
