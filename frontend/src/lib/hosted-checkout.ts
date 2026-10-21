export function hostedCheckoutTarget(checkoutUrl: string, session: string, origin: string) {
 const action = new URL(checkoutUrl);
 const site = new URL(origin);
 if(action.origin !== 'https://payment.paidlayer.com' || action.username || action.password || action.search || action.hash || !/^\/[a-zA-Z0-9_-]{1,128}$/.test(action.pathname)) throw new Error('Invalid checkout URL');
 if(!session || site.username || site.password || (site.protocol !== 'https:' && !(site.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(site.hostname)))) throw new Error('Invalid payment return');
 const success = new URL('/payments/return', site.origin);
 success.searchParams.set('session', session);
 const fail = new URL(success);
 success.searchParams.set('payment','success');
 fail.searchParams.set('payment','failed');
 return {action:action.href,successUrl:success.href,failUrl:fail.href};
}
export function submitHostedCheckout(checkoutUrl:string, session:string) {
 const target=hostedCheckoutTarget(checkoutUrl,session,window.location.origin);
 const form=document.createElement('form');
 form.method='POST';form.action=target.action;form.hidden=true;
 for(const name of ['successUrl','failUrl'] as const){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=target[name];form.appendChild(input);}
 document.body.appendChild(form);form.submit();
}
