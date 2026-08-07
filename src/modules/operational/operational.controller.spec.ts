import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { AnalyticsController } from '../analytics/analytics.controller.js';
import { OperationalController } from './operational.controller.js';
import type { OperationalService } from './operational.service.js';
import type { OperationalOptionsService } from './operational-options.service.js';
import { operationalFiltersSchema } from './dto/operational-filters.dto.js';

const PUBLIC_ROUTE_KEY = 'PUBLIC';

function reflectedHandlers(): string[] {
  return Object.getOwnPropertyNames(OperationalController.prototype)
    .filter((name) => name !== 'constructor')
    .sort();
}

const EXPECTED_HANDLER_COUNT = 7;

describe('OperationalController', () => {
  it('carries no public-route metadata on the controller or on any handler', () => {
    expect(
      Reflect.getMetadata(PUBLIC_ROUTE_KEY, OperationalController),
    ).toBeUndefined();

    const handlers = reflectedHandlers();
    expect(handlers.length).toBeGreaterThan(0);

    for (const handler of handlers) {
      expect(
        Reflect.getMetadata(
          PUBLIC_ROUTE_KEY,
          OperationalController.prototype[
            handler as keyof OperationalController
          ],
        ),
        handler,
      ).toBeUndefined();
    }
  });

  it('exposes the seven routes that complete the six-tab set', () => {
    const handlers = reflectedHandlers();

    expect(handlers).toHaveLength(EXPECTED_HANDLER_COUNT);
    expect(handlers).toEqual([
      'community',
      'contacts',
      'filterOptions',
      'hf',
      'labs',
      'poe',
      'summary',
    ]);
  });

  it('leaves the public metrics surface public — D-01 regression guard', () => {
    expect(
      Reflect.getMetadata(
        PUBLIC_ROUTE_KEY,
        AnalyticsController.prototype.metrics,
      ),
    ).toBe(true);
  });

  it('delegates the validated query to the labs tab service', async () => {
    const labsTab = vi.fn().mockResolvedValue({ cards: [] });
    const controller = new OperationalController(
      { labsTab } as unknown as OperationalService,
      {} as unknown as OperationalOptionsService,
    );

    const query = operationalFiltersSchema.parse({ period: '42d' });
    const result = await controller.labs(query);

    expect(labsTab).toHaveBeenCalledWith(query);
    expect(result).toEqual({ cards: [] });
  });

  it('delegates one handler per tab to one service method', async () => {
    const communityTab = vi.fn().mockResolvedValue({ cards: [] });
    const summaryTab = vi.fn().mockResolvedValue({ cards: [] });
    const controller = new OperationalController(
      { communityTab, summaryTab } as unknown as OperationalService,
      {} as unknown as OperationalOptionsService,
    );

    const query = operationalFiltersSchema.parse({ period: '7d' });

    await controller.community(query);
    expect(communityTab).toHaveBeenCalledWith(query);
    expect(summaryTab).not.toHaveBeenCalled();

    await controller.summary(query);
    expect(summaryTab).toHaveBeenCalledWith(query);
    expect(summaryTab).toHaveBeenCalledTimes(1);
  });
});
