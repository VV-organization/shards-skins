import { Inject, Injectable, ServiceUnavailableException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { APP_CONFIG } from './app-config.module';
import type { AppConfig } from './app-config';

/** Only blocks creation. Reconciliation, callbacks and owner status reads must remain available. */
@Injectable()
export class CommerceEnabledGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{method: string; path: string}>();
    if (request.method !== 'POST') return true;
    const path = request.path.replace(/\/$/, '');
    const checkout = /^\/checkout(?:\/cart)?$/.test(path);
    const payment = /^\/payments\/(?:top-up|steam-refill)\/sessions$/.test(path);
    if ((checkout && !this.config.commerce?.checkoutEnabled) || (payment && !this.config.commerce?.paymentsEnabled)) {
      throw new ServiceUnavailableException({ code: 'COMMERCE_UNAVAILABLE', message: 'Операция временно недоступна' });
    }
    return true;
  }
}
