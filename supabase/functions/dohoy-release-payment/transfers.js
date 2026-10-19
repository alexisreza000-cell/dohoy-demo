import {stripeKey} from './mode.js';
// All amounts use integer centavos. Only server code can write the ledger.
export class TransferError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
const fail = (code, msg) => { throw new TransferError(code, msg); };
export function amounts(payment) {
  const gross = Math.round(Number(payment.amount_total) * 100);
  const fee = Math.round(gross * 0.15);
  const net = gross - fee;
  if (!Number.isSafeInteger(gross) || gross <= 0 || net <= 0 ||
      Math.round(Number(payment.worker_net_amount) * 100) !== net ||
      Math.round(Number(payment.commission_amount) * 100) !== fee ||
      Number(payment.commission_rate) !== 0.15 || payment.currency !== 'mxn')
    fail('invalid_amount', 'El monto del pago requiere revisión.');
  return { gross, fee, net };
}
async function one(q) { const {data,error} = await q; if (error) throw error; return data; }
async function lock(admin, id) {
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = await one(admin.from('worker_transfers').update({lock_token:token,
    locked_until:new Date(Date.now()+300000).toISOString()})
    .eq('payment_id',id).or(`locked_until.is.null,locked_until.lt.${now}`).select('*').maybeSingle());
  if (!row) fail('processing', 'Ya estamos procesando este movimiento. Actualiza en unos momentos.');
  return {row,token};
}
async function write(admin,id,token,patch) {
  const row = await one(admin.from('worker_transfers').update({...patch,updated_at:new Date().toISOString()})
    .eq('payment_id',id).eq('lock_token',token).select('*').maybeSingle());
  if (!row) fail('lease_lost', 'Actualiza para consultar el resultado del movimiento.');
  return row;
}
function validateTransfer(t,row) {
  if (!t?.id || t.amount !== row.amount_cents || t.currency !== row.currency ||
      t.destination !== row.destination_account || t.source_transaction !== row.source_charge_id ||
      t.transfer_group !== row.transfer_group || t.livemode !== row.stripe_livemode)
    fail('transfer_mismatch', 'El movimiento en Stripe requiere revisión.');
}
async function existingTransfer(stripe,row) {
  if (row.stripe_transfer_id) {
    const t = await stripe(`/v1/transfers/${encodeURIComponent(row.stripe_transfer_id)}`);
    validateTransfer(t,row); return t;
  }
  const list = await stripe(`/v1/transfers?transfer_group=${encodeURIComponent(row.transfer_group)}&limit=2`);
  if (list.has_more || list.data?.length > 1) fail('duplicate_transfer','Hay movimientos que requieren revisión.');
  const t = list.data?.[0]; if (t) validateTransfer(t,row); return t || null;
}
export async function releasePayment(admin,stripe,payment,task,recipient,live=false) {
  if (task.status !== 'completed' || !task.completed_at)
    fail('task_not_completed','El cliente debe confirmar que el trabajo terminó.');
  if (payment.task_id !== task.id || payment.worker_id !== task.worker_id || payment.client_id !== task.client_id)
    fail('participants_mismatch','El pago requiere revisión.');
  if (payment.payment_status !== 'paid' || Number(payment.refunded_amount||0)>0)
    fail('payment_not_paid','El pago debe estar confirmado y sin reembolsos.');
  if (!recipient?.stripe_connect_account_id) fail('connect_required','Activa tu cuenta con Stripe antes de recibir ganancias.');
  if (recipient.is_suspended) fail('account_suspended','La cuenta del trabajador requiere revisión.');
  const {gross,net} = amounts(payment);
  // Disputed payments must not even create a pending transfer record.
  const {data: existingDisputes,error: holdError}=await admin.from('payment_disputes')
    .select('stripe_dispute_id').eq('payment_id',payment.id).limit(1);
  if(holdError)throw holdError;
  if(existingDisputes?.length)fail('disputed_payment','Este pago tiene una disputa bancaria y sus ganancias están retenidas.');
  if (!/^pi_/.test(payment.stripe_payment_intent_id||'')) fail('intent_missing','No se encontró el pago en Stripe.');
  const pi = await stripe(`/v1/payment_intents/${encodeURIComponent(payment.stripe_payment_intent_id)}?expand[]=latest_charge`);
  if (payment.stripe_livemode!==live || pi.livemode!==live) fail('mode_mismatch','El pago pertenece a otro entorno.');
  if (pi.status !== 'succeeded' || pi.currency !== payment.currency || pi.amount_received !== gross ||
      pi.metadata?.payment_id !== payment.id || pi.metadata?.task_id !== task.id)
    fail('intent_mismatch','El pago en Stripe no coincide con este trabajo.');
  const charge = pi.latest_charge;
  if (!charge?.id || charge.paid !== true || charge.captured !== true || charge.amount !== gross ||
      charge.currency !== payment.currency || charge.amount_refunded > 0 || charge.refunded || charge.disputed)
    fail('charge_unavailable','El cobro tiene un reembolso, una disputa o todavía no está disponible.');
  const snapshot = {payment_id:payment.id,task_id:task.id,worker_id:payment.worker_id,client_id:payment.client_id,
    stripe_livemode:live,amount_cents:net,currency:payment.currency,destination_account:recipient.stripe_connect_account_id,
    source_charge_id:charge.id,transfer_group:`dohoy_${payment.id}`,status:'pending'};
  // A duplicate insert must never overwrite a previously frozen destination or amount.
  const inserted = await admin.from('worker_transfers').insert(snapshot);
  if (inserted.error && inserted.error.code !== '23505') throw inserted.error;
  const {row,token} = await lock(admin,payment.id);
  try {
    for (const k of ['stripe_livemode','task_id','worker_id','client_id','amount_cents','currency','destination_account','source_charge_id','transfer_group'])
      if (row[k] !== snapshot[k]) fail('snapshot_mismatch','Los datos del movimiento cambiaron y requieren revisión.');
    let transfer = await existingTransfer(stripe,row);
    if (!transfer) {
      // Fail closed if this payment has ever entered a bank dispute.
      // A dispute that was later won still needs an explicit administrative review.
      const {data: disputes,error: disputeError} = await admin.from('payment_disputes')
        .select('stripe_dispute_id').eq('payment_id',payment.id).limit(1);
      if (disputeError) throw disputeError;
      if (disputes?.length) fail('disputed_payment','Este pago tiene una disputa bancaria y requiere revisión antes de enviar ganancias.');
      // Connect Accounts v2: verify recipient ownership and transfer capability before sending money.
      const v2response = await fetch(`https://api.stripe.com/v2/core/accounts/${encodeURIComponent(row.destination_account)}?include%5B0%5D=configuration.recipient`, {
        headers: {Authorization: `Bearer ${stripeKey(live)}`, 'Stripe-Version': '2026-09-30.endive'},
        signal: AbortSignal.timeout(15000)
      });
      const account = await v2response.json();
      if (!v2response.ok) fail('connect_check_failed','No se pudo validar la cuenta del trabajador con Stripe.');
      if (account.id !== row.destination_account || account.livemode !== live ||
          account.metadata?.supabase_user_id !== payment.worker_id)
        fail('account_owner_mismatch','La cuenta Stripe no corresponde al trabajador o al entorno de pagos.');
      if (account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status !== 'active')
        fail('connect_inactive','Stripe todavía no habilita las transferencias de esta cuenta.');
      // Recheck the charge after acquiring the lock to reduce refund races.
      const currentCharge = await stripe(`/v1/charges/${encodeURIComponent(charge.id)}`);
      if (currentCharge.amount_refunded > 0 || currentCharge.refunded || currentCharge.disputed)
        fail('charge_unavailable','El cobro tiene un reembolso o una disputa.');
      transfer = await stripe('/v1/transfers','POST',{
        amount:String(row.amount_cents),currency:row.currency,destination:row.destination_account,
        source_transaction:row.source_charge_id,transfer_group:row.transfer_group,
        'metadata[payment_id]':payment.id,'metadata[task_id]':task.id,'metadata[worker_id]':payment.worker_id
      },`dohoy-transfer-${payment.id}`);
      validateTransfer(transfer,row);
    }
    return await write(admin,payment.id,token,{stripe_transfer_id:transfer.id,
      status:transfer.amount_reversed===transfer.amount?'reversed':'transferred',
      reversed_amount_cents:transfer.amount_reversed||0,last_error:null,
      transferred_at:new Date(transfer.created*1000).toISOString()});
  } catch (err) {
    // Keep the snapshot so a timeout can be reconciled by transfer_group on retry.
    await write(admin,payment.id,token,{last_error:String(err.message||err).slice(0,250)}).catch(()=>{});
    throw err;
  } finally {
    await write(admin,payment.id,token,{lock_token:null,locked_until:null}).catch(()=>{});
  }
}
export async function reverseForRefund(admin,stripe,intentId) {
  const payment = await one(admin.from('task_payments').select('id').eq('stripe_payment_intent_id',intentId).maybeSingle());
  if (!payment) return;
  const ledger = await one(admin.from('worker_transfers').select('*').eq('payment_id',payment.id).maybeSingle());
  if (!ledger) return;
  const {row,token} = await lock(admin,payment.id);
  try {
    let transfer = await existingTransfer(stripe,row);
    if (!transfer) return;
    const charge = await stripe(`/v1/charges/${encodeURIComponent(row.source_charge_id)}`);
    if (charge.livemode !== row.stripe_livemode) fail('mode_mismatch','El reembolso pertenece a otro entorno.');
    const target = Math.min(row.amount_cents,Math.round(row.amount_cents*charge.amount_refunded/charge.amount));
    const remaining = target-(transfer.amount_reversed||0);
    if (remaining > 0) {
      await stripe(`/v1/transfers/${encodeURIComponent(transfer.id)}/reversals`,'POST',
        {amount:String(remaining),'metadata[payment_id]':payment.id},`dohoy-reverse-${payment.id}-${target}`);
      transfer = await stripe(`/v1/transfers/${encodeURIComponent(transfer.id)}`);
      validateTransfer(transfer,row);
    }
    await write(admin,payment.id,token,{stripe_transfer_id:transfer.id,
      reversed_amount_cents:transfer.amount_reversed||0,
      status:transfer.amount_reversed===transfer.amount?'reversed':'transferred',last_error:null});
  } catch(err) {
    await write(admin,payment.id,token,{last_error:'Reembolso: '+String(err.message||err).slice(0,200)}).catch(()=>{});
    throw err; // Stripe retries the signed webhook if reversal failed.
  } finally { await write(admin,payment.id,token,{lock_token:null,locked_until:null}).catch(()=>{}); }
}
