import { describe, expect, it } from 'vitest';

import { nairobiToday as operationalNairobiToday } from '../modules/operational/operational.service.js';
import { nairobiToday } from './nairobi-date.js';

describe('nairobiToday', () => {
  it('is the calendar date in Africa/Nairobi, three hours ahead of UTC', () => {
    expect(nairobiToday(new Date('2026-10-06T20:59:59Z'))).toBe('2026-10-06');
    expect(nairobiToday(new Date('2026-10-06T21:00:00Z'))).toBe('2026-10-07');
    expect(nairobiToday(new Date('2026-12-31T21:00:00Z'))).toBe('2027-01-01');
  });

  it('defaults to the current instant, written YYYY-MM-DD', () => {
    expect(nairobiToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is the one helper the operational summary uses', () => {
    expect(operationalNairobiToday).toBe(nairobiToday);
  });
});
