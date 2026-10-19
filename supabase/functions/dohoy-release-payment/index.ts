import {stripeMode,stripeKey,accountColumn,requireClient} from './mode.js';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.117.2';
import {releasePayment,TransferError} from './transfers.js';
import {stripeRequestFor} from './stripe-api.js';
const cors={'Access-Control-Allow-Origin': 'https://www.dohoy.com.mx',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-dohoy-version',
  'Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const admin=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'');
async function one(q) {const {data,error}=await q;if(error)throw error;return data;}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return reply({error:'Método no permitido.'},405);
  try {
    const live=stripeMode(),stripeRequest=stripeRequestFor(live);
    requireClient(req,live);
    const auth=req.headers.get('authorization');
    if(!auth?.startsWith('Bearer '))return reply({error:'Inicia sesión para continuar.'},401);
    const client=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_ANON_KEY')||'',{global:{headers:{Authorization:auth}}});
    const {data,error}=await client.auth.getUser();
    if(error||!data.user)return reply({error:'Tu sesión no es válida.'},401);
    const me=await one(admin.from('profiles').select('id,is_admin,is_suspended,stripe_connect_account_id,stripe_connect_live_account_id').eq('id',data.user.id).single());
    if(me.is_suspended)return reply({error:'Tu cuenta requiere revisión.'},403);
    const body=await req.json().catch(()=>({}));
    if(body.action==='status'){
  me.stripe_connect_account_id=me[accountColumn(live)];
      // Return dispute holds for this authenticated worker's own visible payments.
      const ownPayments=await one(admin.from('task_payments').select('id')
        .eq('worker_id',me.id).eq('stripe_livemode',live)
        .order('created_at',{ascending:false}).limit(100));
      const ownIds=(ownPayments||[]).map(p=>p.id);
      const holds=ownIds.length?await one(admin.from('payment_disputes')
        .select('payment_id').in('payment_id',ownIds)):[];
      const disputed_payment_ids=[...new Set((holds||[]).map(p=>p.payment_id))];
      if(!me.stripe_connect_account_id)return reply({connected:false,transfers_active:false,test_mode:!live,disputed_payment_ids});
      const accountId=encodeURIComponent(me.stripe_connect_account_id);
      const response=await fetch(`https://api.stripe.com/v2/core/accounts/${accountId}?include%5B0%5D=configuration.recipient`,{
        headers:{Authorization:`Bearer ${stripeKey(live)}`,'Stripe-Version':'2026-09-30.endive'},
        signal:AbortSignal.timeout(15000)
      });
      const account=await response.json();
      if(!response.ok)throw new Error(account?.error?.message||'Stripe no pudo consultar la cuenta conectada.');
      if(account.id!==me.stripe_connect_account_id||account.livemode!==live)throw new Error('La cuenta conectada no corresponde al entorno de pagos.');
      const recipient=account.configuration?.recipient;
      const capability=recipient?.capabilities?.stripe_balance?.stripe_transfers;
      const active=capability?.status==='active';
      const applied=Array.isArray(account.applied_configurations)?account.applied_configurations:[];
      const transferStatus=capability?.status||'unavailable';
      const details=Array.isArray(capability?.status_details)?capability.status_details:[];
      const reasons=details.map(d=>String(d?.resolution||d?.code||d?.type||'').slice(0,80)).filter(Boolean).slice(0,3);
      const statusMessage=active?'Stripe confirmó que la cuenta puede recibir transferencias.':
        !applied.includes('recipient')?'Stripe todavía no muestra la configuración para recibir transferencias.':
        !recipient?'Stripe no devolvió los detalles de la configuración de transferencias.':
        !capability?'Stripe no devolvió la capacidad stripe_transfers; la cuenta requiere revisión.':
        transferStatus==='pending'?'La capacidad de transferencias está pendiente de aprobación en Stripe.':
        transferStatus==='inactive'?'La capacidad de transferencias está inactiva; revisa los requisitos en Stripe.':
        'Stripe informa que la capacidad de transferencias está en estado '+transferStatus+'.';
      return reply({connected:true,transfers_active:active,payouts_enabled:false,test_mode:!live,disputed_payment_ids,
        transfer_status:transferStatus,applied_recipient:applied.includes('recipient'),recipient_details_available:!!recipient,
        status_message:statusMessage+(reasons.length?' Detalles: '+reasons.join(', '):'')});
    }
    if(!/^[0-9a-f-]{36}$/i.test(body.task_id||''))return reply({error:'Trabajo no válido.'},400);
    const task=await one(admin.from('tasks').select('id,status,completed_at,client_id,worker_id').eq('id',body.task_id).maybeSingle());
    if(!task||![task.client_id,task.worker_id].includes(data.user.id))return reply({error:'No puedes acceder a este trabajo.'},403);
    const payment=await one(admin.from('task_payments').select('*').eq('task_id',task.id).eq('payment_status','paid').eq('stripe_livemode',live).maybeSingle());
    if(!payment)return reply({error:'No hay un pago confirmado para este trabajo.'},409);
    const recipient=await one(admin.from('profiles').select('id,is_admin,is_suspended,stripe_connect_account_id,stripe_connect_live_account_id').eq('id',task.worker_id).single());
    recipient.stripe_connect_account_id=recipient[accountColumn(live)];
 const ledger=await releasePayment(admin,stripeRequest,payment,task,recipient,live);
    return reply({ok:true,status:ledger.status,amount:ledger.amount_cents/100,currency:ledger.currency,
      stripe_transfer_id:ledger.stripe_transfer_id,test_mode:!live});
  }catch(err){
    console.error('DOHOY transfer failed',err.code||'',err.message||err);
    return reply({error:err instanceof TransferError?err.message:'No pudimos confirmar la transferencia. Puedes reintentar sin duplicar el envío.',
      code:err instanceof TransferError?err.code:'transfer_failed'},err instanceof TransferError?err.status:502);
  }
});
