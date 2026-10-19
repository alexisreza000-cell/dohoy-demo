export function stripeMode() {
 const mode=Deno.env.get('DOHOY_STRIPE_MODE')||'test';
 if(!['test','live'].includes(mode)) throw Error('Modo de pagos inválido.');
 return mode==='live';
}
export function stripeKey(live=stripeMode()) {
 const key=Deno.env.get(live?'STRIPE_LIVE_SECRET_KEY':'STRIPE_SECRET_KEY')||'';
 if(!(live?/^(sk|rk)_live_/:/^(sk|rk)_test_/).test(key))throw Error('La clave Stripe no corresponde al modo de pagos.');
 if(live&&!Deno.env.get('STRIPE_LIVE_WEBHOOK_SECRET'))throw Error('Falta la firma de pagos reales.');
 return key;
}
export const accountColumn=(live)=>live?'stripe_connect_live_account_id':'stripe_connect_account_id';
export function requireClient(req,live) {
 if(live&&req.headers.get('x-dohoy-version')!=='5.1.0')throw Error('Actualiza DOHOY antes de usar pagos reales.');
}
