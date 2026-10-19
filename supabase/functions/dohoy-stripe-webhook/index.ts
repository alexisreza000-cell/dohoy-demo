import Stripe from 'https://esm.sh/stripe@14.25.0?target=denonext';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.117.2';
import {stripeRequestFor} from './stripe-api.js';
import {reverseForRefund} from './transfers.js';
const admin=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'');
const sdk=new Stripe(Deno.env.get('STRIPE_SECRET_KEY')||'not-used-for-api',{apiVersion:'2023-10-16'});
const cryptoProvider=Stripe.createSubtleCryptoProvider();
const reply=(body:unknown,status=200)=>Response.json(body,{status});
const id=(v:any)=>typeof v==='string'?v:v?.id;
async function one(q:any){const {data,error}=await q;if(error)throw error;return data;}
Deno.serve(async req=>{
 if(req.method==='GET')return reply({service:'dohoy-stripe-webhook',accepting_events:true,live_signature_configured:!!Deno.env.get('STRIPE_LIVE_WEBHOOK_SECRET')});
 if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
 const sig=req.headers.get('stripe-signature');if(!sig)return reply({error:'missing_signature'},400);
 const raw=await req.text();let event:any=null,live=false;
 // Accept the existing test endpoint and the new disputes endpoint without
 // overwriting either secret. Live events keep a separate signing secret.
 for(const candidate of [
  {live:false,name:'STRIPE_WEBHOOK_SECRET'},
  {live:false,name:'STRIPE_TEST_DISPUTES_WEBHOOK_SECRET'},
  {live:true,name:'STRIPE_LIVE_WEBHOOK_SECRET'}
 ]){
  const secret=Deno.env.get(candidate.name);if(!secret)continue;
  try{const verified=await sdk.webhooks.constructEventAsync(raw,sig,secret,undefined,cryptoProvider);
   if(verified.livemode!==candidate.live)continue;event=verified;live=candidate.live;break;
  }catch{}
 }
 if(!event)return reply({error:'invalid_signature'},400);
 const supported=['payment_intent.succeeded','payment_intent.payment_failed','checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired','charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated'];
 if(!supported.includes(event.type))return reply({received:true,ignored:true});
 try{
  const stripe=stripeRequestFor(live);let object=event.data.object;
  if(event.type.startsWith('charge.dispute.')){
   // Stripe may deliver events more than once or out of order. Always load current dispute status.
   const disputeId=id(object?.id);
   if(!/^du_/.test(disputeId||''))throw Error('invalid_dispute_id');
   const dispute=await stripe('/v1/disputes/'+encodeURIComponent(disputeId));
   const chargeId=id(dispute.charge);
   if(!/^ch_/.test(chargeId||'')||dispute.livemode!==live)throw Error('dispute_mode_mismatch');
   const charge=await stripe('/v1/charges/'+encodeURIComponent(chargeId));
   if(charge.livemode!==live)throw Error('charge_mode_mismatch');
   const intentId=id(charge.payment_intent);
   if(!intentId)return reply({received:true,ignored:true});
   const payment=await one(admin.from('task_payments').select('id,task_id,currency,stripe_livemode')
     .eq('stripe_payment_intent_id',intentId).maybeSingle());
   if(!payment)return reply({received:true,ignored:true});
   if(payment.stripe_livemode!==live||payment.currency!==dispute.currency)throw Error('dispute_payment_mismatch');
   const record={payment_id:payment.id,stripe_dispute_id:dispute.id,stripe_livemode:live,
     status:String(dispute.status||'unknown'),amount_cents:Number(dispute.amount||0),
     currency:dispute.currency,reason:dispute.reason||null,updated_at:new Date().toISOString()};
   const {error:saveError}=await admin.from('payment_disputes').upsert(record,{onConflict:'stripe_dispute_id'});
   if(saveError)throw saveError;
   console.warn('DOHOY payment dispute recorded',payment.id,dispute.id,dispute.status);
   return reply({received:true,dispute_recorded:true});
  }
  // Normalize snapshot versions by retrieving the current object using our pinned API.
  if(event.type.startsWith('checkout.'))object=await stripe('/v1/checkout/sessions/'+encodeURIComponent(object.id));
  else if(event.type==='charge.refunded')object=await stripe('/v1/charges/'+encodeURIComponent(object.id));
  else object=await stripe('/v1/payment_intents/'+encodeURIComponent(object.id));
  if(object.livemode!==live)throw Error('mode_mismatch');
  const intentId=event.type.startsWith('payment_intent.')?object.id:id(object.payment_intent);
  const paymentId=object.metadata?.payment_id;
  if(!paymentId&&!intentId)return reply({received:true,ignored:true});
  const payment=await one(paymentId?admin.from('task_payments').select('*').eq('id',paymentId).maybeSingle():admin.from('task_payments').select('*').eq('stripe_payment_intent_id',intentId).maybeSingle());
  if(!payment)return reply({received:true,ignored:true});
  if(payment.stripe_livemode!==live)throw Error('mode_mismatch');
  let patch:any={last_stripe_event_id:event.id,updated_at:new Date().toISOString()};
  if(intentId){
   const pi=await stripe('/v1/payment_intents/'+encodeURIComponent(intentId)+'?expand[]=latest_charge');
   if(pi.livemode!==live||pi.metadata?.payment_id!==payment.id||pi.metadata?.task_id!==payment.task_id||pi.currency!==payment.currency||pi.amount!==Math.round(Number(payment.amount_total)*100))throw Error('payment_mismatch');
   if(payment.stripe_payment_intent_id&&payment.stripe_payment_intent_id!==pi.id)throw Error('intent_mismatch');
   patch.stripe_payment_intent_id=pi.id;
   if(pi.status==='succeeded'){
    if(pi.amount_received!==pi.amount)throw Error('amount_mismatch');
    const charge=pi.latest_charge;
    if(!charge?.paid||!charge.captured||charge.livemode!==live)throw Error('charge_unavailable');
    if(charge.amount_refunded>0){patch.payment_status=charge.refunded?'refunded':'partially_refunded';patch.refunded_amount=charge.amount_refunded/100;patch.refunded_at=payment.refunded_at||new Date().toISOString();}
    else {patch.payment_status='paid';patch.paid_at=payment.paid_at||new Date().toISOString();patch.failure_message=null;patch.failure_code=null;}
   }else if(pi.status==='requires_payment_method'){patch.payment_status=(payment.stripe_checkout_session_id||payment.metadata?.checkout_version===2)?'processing':'failed';patch.failure_code=pi.last_payment_error?.code||null;patch.failure_message=pi.last_payment_error?.message||null;}
   else if(pi.status==='canceled')patch.payment_status='cancelled';
   else patch.payment_status='processing';
  }else if(event.type==='checkout.session.expired'&&!['paid','refunded','partially_refunded'].includes(payment.payment_status))patch.payment_status='cancelled';
  if(event.type.startsWith('checkout.')){
   if(object.status==='expired'&&!['paid','refunded','partially_refunded'].includes(patch.payment_status))patch.payment_status='cancelled';
   if(object.metadata?.task_id!==payment.task_id||object.amount_total!==Math.round(Number(payment.amount_total)*100)||object.currency!==payment.currency)throw Error('session_mismatch');
   if(payment.stripe_checkout_session_id&&payment.stripe_checkout_session_id!==object.id)throw Error('session_mismatch');
   patch.stripe_checkout_session_id=object.id;
  }
  const updated=await one(admin.from('task_payments').update(patch).eq('id',payment.id).eq('stripe_livemode',live).select('id').single());
  if(patch.payment_status==='paid'&&payment.payment_status!=='paid'){
   const {error}=await admin.from('notifications').insert({user_id:payment.worker_id,task_id:payment.task_id,type:'payment_confirmed',title:'Pago confirmado',body:'El pago está listo. Ya puedes comenzar cuando corresponda.'});if(error&&error.code!=='23505')throw error;
  }
  if(['refunded','partially_refunded'].includes(patch.payment_status)&&intentId)await reverseForRefund(admin,stripe,intentId);
  return reply({received:true,event_id:event.id});
 }catch(e){console.error('DOHOY webhook processing failed',e instanceof Error?e.message:'processing_error');return reply({error:'webhook_processing_failed'},500);}
});
