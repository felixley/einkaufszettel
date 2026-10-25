import { describe, expect, it } from 'vitest';

import { TOOLING_SMOKE, toolingSmoke } from './smoke.js';

describe('tooling smoke', () => {
  it('liefert den Tooling-Marker', () => {
    expect(toolingSmoke()).toBe(TOOLING_SMOKE);
  });
});
