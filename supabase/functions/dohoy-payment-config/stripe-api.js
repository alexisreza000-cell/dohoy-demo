import {stripeKey} from './mode.js';
export function stripeRequestFor(live) { return async function stripeRequest(path,method='GET',params=null,idempotencyKey=null) {
  const key = stripeKey(live);
  if (!key) throw new Error('Stripe no está configurado.');
  const headers = {Authorization:`Bearer ${key}`,'Stripe-Version':'2023-10-16'};
  if (method === 'POST') headers['Content-Type']='application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key']=idempotencyKey;
  const response = await fetch('https://api.stripe.com'+path,{method,headers,
    ...(params?{body:new URLSearchParams(params)}:{}),signal:AbortSignal.timeout(15000)});
  const body = await response.json();
  if (!response.ok) { console.error('Stripe operation failed',body.error?.code,response.headers.get('request-id'));
    throw new Error(body.error?.message||'Stripe no pudo procesar el movimiento.'); }
  return body;
}

}
