import {stripeMode,stripeKey,accountColumn,requireClient} from './mode.js';
import Stripe from 'https://esm.sh/stripe@14.25.0?target=denonext';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.117.2';

const url=Deno.env.get('SUPABASE_URL')||'';
const anon=Deno.env.get('SUPABASE_ANON_KEY')||'';
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'');
const cors={'Access-Control-Allow-Origin':'https://www.dohoy.com.mx',
 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-dohoy-version',
 'Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const reply=(body,status=200)=>Response.json(body,{status,headers:cors});
class CheckoutError extends Error {
 constructor(message,status=409){super(message);this.status=status;}
}
const fail=(message,status=409)=>{throw new CheckoutError(message,status)};
async function one(query){const {data,error}=await query;if(error)throw error;return data;}
function validateSession(session,payment,live){
 if(session.livemode!==live||session.metadata?.payment_id!==payment.id||
    session.metadata?.task_id!==payment.task_id||session.currency!==payment.currency||
    session.amount_total!==Math.round(Number(payment.amount_total)*100))
  fail('El intento de pago requiere revisión. No se creará otro cobro.');
}
function checkoutResult(session,payment,live,reused=false){
 return reply({checkout_url:session.url,payment_id:payment.id,reused,test_mode:!live,
  amount_total:Number(payment.amount_total),commission_amount:Number(payment.commission_amount),
  worker_net_amount:Number(payment.worker_net_amount),currency:payment.currency});
}
async function checkRecipient(profile,live){
 const id=profile[accountColumn(live)];
 if(!id)fail('El trabajador debe activar su cuenta de ganancias en Stripe antes del pago.');
 const response=await fetch(`https://api.stripe.com/v2/core/accounts/${encodeURIComponent(id)}?include%5B0%5D=configuration.recipient`,{
  headers:{Authorization:`Bearer ${stripeKey(live)}`,'Stripe-Version':'2026-09-30.endive'},
  signal:AbortSignal.timeout(15000)});
 const account=await response.json();
 if(!response.ok)fail('No pudimos comprobar la cuenta del trabajador. Reintenta más tarde.',503);
 if(account.id!==id||account.livemode!==live||account.metadata?.supabase_user_id!==profile.id)
  fail('La cuenta de ganancias del trabajador requiere revisión.');
 if(account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status!=='active')
  fail('Stripe todavía no habilita las transferencias del trabajador. Debe revisar Ganancias antes del pago.');
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'Método no permitido.'},405);
 try{
  const live=stripeMode();
  try{requireClient(req,live)}catch{fail('Actualiza DOHOY antes de usar pagos reales.',409)}
  const stripe=new Stripe(stripeKey(live),{apiVersion:'2023-10-16'});
  const auth=req.headers.get('authorization')||'';
  if(!auth.startsWith('Bearer '))fail('Inicia sesión para pagar.',401);
  const client=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const {data,error}=await client.auth.getUser();
  if(error||!data.user)fail('Tu sesión no es válida. Inicia sesión otra vez.',401);
  const body=await req.json().catch(()=>({}));
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.task_id||''))fail('Trabajo no válido.',400);
  const task=await one(admin.from('tasks').select('id,title,client_id,worker_id,offered_price,status').eq('id',body.task_id).maybeSingle());
  if(!task)fail('No encontramos este trabajo.',404);
  if(task.client_id!==data.user.id)fail('Solo el cliente puede pagar este trabajo.',403);
  if(!task.worker_id||task.worker_id===task.client_id)fail('Elige un trabajador para continuar.');
  if(!['assigned','in_progress'].includes(task.status))fail('Este trabajo no está disponible para pago.');
  const profiles=await one(admin.from('profiles').select('id,is_suspended,stripe_connect_account_id,stripe_connect_live_account_id').in('id',[task.client_id,task.worker_id]));
  const payer=profiles.find(p=>p.id===task.client_id),recipient=profiles.find(p=>p.id===task.worker_id);
  if(!payer||!recipient||payer.is_suspended||recipient.is_suspended)fail('Una de las cuentas requiere revisión.',403);
  const otherMode=await one(admin.from('task_payments').select('id').eq('task_id',task.id).neq('stripe_livemode',live).limit(1));
  if(otherMode.length)fail('Este trabajo pertenece a otro entorno. Crea una tarea nueva.');
  let payment=await one(admin.from('task_payments').select('*').eq('task_id',task.id).eq('stripe_livemode',live).order('created_at',{ascending:false}).limit(1).maybeSingle());
  if(payment?.payment_status==='paid')fail('El pago ya está confirmado. Actualiza la tarea.');
  if(['refunded','partially_refunded'].includes(payment?.payment_status))fail('Este trabajo tiene un reembolso. Revisa su recibo antes de hacer otro pago.');
  if(payment?.stripe_checkout_session_id){
   const session=await stripe.checkout.sessions.retrieve(payment.stripe_checkout_session_id);
   validateSession(session,payment,live);
   if(session.payment_status==='paid'||session.status==='complete')fail('Stripe está confirmando este pago. Actualiza en unos momentos; no vuelvas a pagar.');
   if(session.status==='open'&&session.url){
    // A declined card can be retried inside the same Checkout session.
    if(!['pending','processing'].includes(payment.payment_status))
     await one(admin.from('task_payments').update({payment_status:'processing',updated_at:new Date().toISOString()}).eq('id',payment.id).eq('payment_status',payment.payment_status).select('id').single());
    await checkRecipient(recipient,live);
    return checkoutResult(session,payment,live,true);
   }
   if(session.status!=='expired')fail('El intento anterior requiere revisión. No se creará otro cobro.');
   await one(admin.from('task_payments').update({payment_status:'cancelled',updated_at:new Date().toISOString()}).eq('id',payment.id).in('payment_status',['pending','processing','failed']).select('id'));
   payment=null;
  }else if(payment&&payment.payment_status!=='cancelled'){
   // Without a saved session, recover exactly the frozen request and key.
   // Never generate a replacement after an ambiguous network failure.
   if(payment.metadata?.checkout_version!==2||!payment.metadata?.checkout_request||
      Date.now()-Date.parse(payment.created_at)>23*60*60*1000)
    fail('El intento anterior requiere revisión antes de continuar. No se creará otro cobro.');
  }else payment=null;
  await checkRecipient(recipient,live);
  if(!payment){
   const offers=await one(admin.from('task_offers').select('amount,status,counter_amount,counter_status').eq('task_id',task.id).eq('worker_id',task.worker_id).order('created_at',{ascending:false}));
   const accepted=offers.find(o=>o.status==='accepted'||o.counter_status==='accepted');
   const amount=Number(accepted?(accepted.counter_status==='accepted'&&accepted.counter_amount!=null?accepted.counter_amount:accepted.amount):task.offered_price);
   const cents=Math.round(amount*100);
   if(!Number.isFinite(amount)||!Number.isSafeInteger(cents)||cents<1000)fail('El pago debe ser de al menos $10 MXN. Revisa el monto acordado.');
   const commission=Math.round(cents*0.15),id=crypto.randomUUID();
   const back=new URL('https://www.dohoy.com.mx/');back.searchParams.set('task',task.id);
   const success=new URL(back);success.searchParams.set('payment','success');success.searchParams.set('session_id','{CHECKOUT_SESSION_ID}');
   const cancel=new URL(back);cancel.searchParams.set('payment','cancelled');
   const params={mode:'payment',payment_method_types:['card'],client_reference_id:task.id,
    success_url:success.toString(),cancel_url:cancel.toString(),
    line_items:[{quantity:1,price_data:{currency:'mxn',unit_amount:cents,product_data:{name:task.title||'Trabajo DOHOY',description:'Pago de servicio en DOHOY'}}}],
    metadata:{payment_id:id,task_id:task.id,client_id:task.client_id,worker_id:task.worker_id},
    payment_intent_data:{metadata:{payment_id:id,task_id:task.id}}};
   const result=await admin.from('task_payments').insert({id,task_id:task.id,client_id:task.client_id,worker_id:task.worker_id,
    currency:'mxn',amount_total:cents/100,commission_rate:0.15,commission_amount:commission/100,worker_net_amount:(cents-commission)/100,
    payment_status:'pending',stripe_livemode:live,metadata:{checkout_version:2,checkout_request:params}}).select('*').single();
   if(result.error?.code==='23505')fail('Otro intento ya está en curso. Pulsa continuar para recuperar ese mismo pago.');
   if(result.error)throw result.error;
   payment=result.data;
  }
  let session;
  try{
   session=await stripe.checkout.sessions.create(payment.metadata.checkout_request,{idempotencyKey:`dohoy-checkout-${payment.id}`});
  }catch(error){
   console.error('DOHOY Checkout creation needs retry',payment.id,error?.code||'network_error');
   // Keep the reservation active so a retry cannot collect money twice.
   fail('No pudimos confirmar la apertura de Stripe. Reintenta para recuperar el mismo pago.',503);
  }
  validateSession(session,payment,live);
  const {error:saveError}=await admin.from('task_payments').update({stripe_checkout_session_id:session.id,
   stripe_payment_intent_id:typeof session.payment_intent==='string'?session.payment_intent:null,
   payment_status:'processing',updated_at:new Date().toISOString()}).eq('id',payment.id).in('payment_status',['pending','processing','failed']);
  if(saveError)throw saveError;
  if(session.payment_status==='paid'||session.status==='complete')fail('Stripe está confirmando este pago. Actualiza la tarea; no vuelvas a pagar.');
  if(session.status!=='open'||!session.url)fail('El intento de pago ha terminado. Actualiza para consultar su resultado.');
  return checkoutResult(session,payment,live);
 }catch(error){
  if(!(error instanceof CheckoutError))console.error('DOHOY Checkout failed',error?.code||'request_error');
  return reply({error:error instanceof CheckoutError?error.message:'No pudimos comprobar el pago. Reintenta sin crear otra tarea ni otro cobro.'},error instanceof CheckoutError?error.status:503);
 }
});
