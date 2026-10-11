import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { loadAppConfig } from './app-config';
import { CommerceEnabledGuard } from './commerce-enabled.guard';
const context = (method: string, path: string) => ({ switchToHttp: () => ({ getRequest: () => ({ method, path }) }) }) as ExecutionContext;
describe('new operations gate', () => {
  it('blocks new checkout and payment sessions until explicitly enabled', () => {
    const gate = new CommerceEnabledGuard(loadAppConfig({}));
    for (const path of ['/checkout/cart','/checkout','/payments/top-up/sessions','/payments/steam-refill/sessions']) {
      expect(() => gate.canActivate(context('POST',path))).toThrow();
    }
  });
  it('keeps callbacks and status reads operational when new submissions are disabled', () => {
    const gate = new CommerceEnabledGuard(loadAppConfig({}));
    expect(gate.canActivate(context('POST','/payments/webhooks/arc-pay'))).toBe(true);
    expect(gate.canActivate(context('GET','/payments/sessions/example'))).toBe(true);
  });
});
