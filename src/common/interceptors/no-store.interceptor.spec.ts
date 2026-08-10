import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';

import { NoStoreInterceptor, NO_STORE_VARY } from './no-store.interceptor.js';

function harness() {
  const setHeader = vi.fn();
  const context = {
    switchToHttp: () => ({ getResponse: () => ({ setHeader }) }),
  } as unknown as ExecutionContext;
  const next = { handle: vi.fn(() => of('payload')) } as CallHandler;
  return { setHeader, context, next };
}

describe('NoStoreInterceptor', () => {
  it('forbids storing the response anywhere', () => {
    const { setHeader, context, next } = harness();

    new NoStoreInterceptor().intercept(context, next);

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('declares the session dimensions the body actually varies by', () => {
    const { setHeader, context, next } = harness();

    new NoStoreInterceptor().intercept(context, next);

    expect(setHeader).toHaveBeenCalledWith('Vary', NO_STORE_VARY);
    expect(NO_STORE_VARY).toContain('Cookie');
    expect(NO_STORE_VARY).toContain('Authorization');
  });

  it('sets the headers before the handler runs, not after it resolves', () => {
    const { setHeader, context, next } = harness();

    new NoStoreInterceptor().intercept(context, next);

    expect(setHeader).toHaveBeenCalledTimes(2);
    expect(next.handle).toHaveBeenCalledTimes(1);
  });

  it('passes the handler stream through untouched', async () => {
    const { context, next } = harness();

    const stream = new NoStoreInterceptor().intercept(context, next);

    await expect(
      new Promise((resolve) => stream.subscribe(resolve)),
    ).resolves.toBe('payload');
  });
});
