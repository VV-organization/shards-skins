import { ForbiddenException, Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { CURRENT_CUSTOMER, type CustomerRequest } from './current-customer';
/** Runs after CustomerSessionGuard. Verified email alone never grants a skin wallet. */
@Injectable()
export class SteamCustomerGuard implements CanActivate {
  constructor(@Inject(UsersService) private readonly users:UsersService) {}
  async canActivate(context:ExecutionContext):Promise<boolean>{
    const request=context.switchToHttp().getRequest<CustomerRequest>();
    const customer=request[CURRENT_CUSTOMER];
    if(!customer || !(await this.users.requireUser(customer.userId)).steam.connected)throw new ForbiddenException({code:'STEAM_IDENTITY_REQUIRED',message:'Войдите через Steam'});
    return true;
  }
}
