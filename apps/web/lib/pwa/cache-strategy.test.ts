import { describe, expect, it } from 'vitest';
import { chooseCacheStrategy, isNeverCachedPath } from './cache-strategy';

describe('chooseCacheStrategy', () => {
  it('wählt network-only für API-, Auth- und PostgREST-Pfade', () => {
    expect(chooseCacheStrategy({ url: 'https://app.test/api/lists' })).toBe('network-only');
    expect(chooseCacheStrategy({ url: 'https://app.test/auth/v1/token' })).toBe('network-only');
    expect(chooseCacheStrategy({ url: 'https://app.test/rest/v1/items?select=*' })).toBe(
      'network-only',
    );
  });

  it('wählt network-only für Nicht-GET-Anfragen', () => {
    expect(
      chooseCacheStrategy({ method: 'POST', mode: 'cors', url: 'https://app.test/lists' }),
    ).toBe('network-only');
  });

  it('wählt network-first für Navigationen', () => {
    expect(chooseCacheStrategy({ mode: 'navigate', url: 'https://app.test/lists' })).toBe(
      'network-first',
    );
    expect(chooseCacheStrategy({ mode: 'navigate', url: 'https://app.test/list/abc' })).toBe(
      'network-first',
    );
  });

  it('wählt stale-while-revalidate für Next-Assets, Icons und das Manifest', () => {
    expect(
      chooseCacheStrategy({ url: 'https://app.test/_next/static/chunks/main-abc123.js' }),
    ).toBe('stale-while-revalidate');
    expect(chooseCacheStrategy({ url: 'https://app.test/icons/icon-192.png' })).toBe(
      'stale-while-revalidate',
    );
    expect(chooseCacheStrategy({ url: 'https://app.test/manifest.webmanifest' })).toBe(
      'stale-while-revalidate',
    );
  });

  it('cacht sonstige GET-Anfragen nicht', () => {
    expect(chooseCacheStrategy({ url: 'https://cdn.example.com/lib.js' })).toBe('network-only');
    expect(chooseCacheStrategy({ url: 'https://app.test/health' })).toBe('network-only');
  });
});

describe('isNeverCachedPath', () => {
  it('erkennt die ausgeschlossenen Präfixe', () => {
    expect(isNeverCachedPath('/api/mock/sync')).toBe(true);
    expect(isNeverCachedPath('/auth/v1/user')).toBe(true);
    expect(isNeverCachedPath('/rest/v1/lists')).toBe(true);
    expect(isNeverCachedPath('/lists')).toBe(false);
  });
});
