const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync('supabase/functions/dohoy-create-checkout/index.ts','utf8').replace(/^import .*;\n/gm,'');
const taskId='11111111-1111-4111-8111-111111111111';
function fixture(options={}){
 const db={tasks:[{id:taskId,title:'Servicio',client_id:'client',worker_id:'worker',status:'assigned',offered_price:100}],profiles:[{id:'client',is_suspended:false},{id:'worker',is_suspended:false,stripe_connect_live_account_id:'acct_worker'}],task_offers:[{task_id:taskId,worker_id:'worker',status:'accepted',amount:100}],task_payments:[]};
 const state={db,created:[],sessions:new Map(),createCalls:[],failAfterCreate:false,failSave:false,capability:'active',accountOwner:'worker',user:'client',queryFailure:false};
 Object.assign(state,options);
 class Query{
  constructor(table){this.table=table;this.filters=[];this.op='read';this.sort=null;this.max=null;this.payload=null;}
  select(){return this}eq(k,v){this.filters.push(r=>r[k]===v);return this}neq(k,v){this.filters.push(r=>r[k]!==v);return this}in(k,v){this.filters.push(r=>v.includes(r[k]));return this}order(k,o){this.sort=[k,o];return this}limit(v){this.max=v;return this}insert(payload){this.op='insert';this.payload=payload;return this}update(payload){this.op='update';this.payload=payload;return this}
  async run(single=false){
   if(state.queryFailure&&this.table==='task_offers')return {data:null,error:{code:'NETWORK'}};
   let rows=db[this.table].filter(r=>this.filters.every(f=>f(r)));
   if(this.sort)rows.sort((a,b)=>String(b[this.sort[0]]).localeCompare(String(a[this.sort[0]])));
   if(this.max!==null)rows=rows.slice(0,this.max);
   if(this.op==='insert'){
    if(db.task_payments.some(p=>p.task_id===this.payload.task_id&&['pending','processing','paid'].includes(p.payment_status)))return {data:null,error:{code:'23505'}};
    const row={...this.payload,created_at:new Date().toISOString()};db[this.table].push(row);rows=[row];
   }
   if(this.op==='update'){
    if(state.failSave&&this.payload.stripe_checkout_session_id){state.failSave=false;return {data:null,error:{code:'NETWORK'}}}
    rows.forEach(r=>Object.assign(r,this.payload));
   }
   return {data:single?(rows[0]?structuredClone(rows[0]):null):structuredClone(rows),error:null};
  }
  maybeSingle(){return this.run(true)}single(){return this.run(true)}then(resolve,reject){return this.run().then(resolve,reject)}
 }
 const admin={from:table=>new Query(table)};
 class Stripe{
  constructor(){this.checkout={sessions:{retrieve:async id=>{if(!state.sessions.has(id))throw Error('missing');return structuredClone(state.sessions.get(id))},create:async(params,opts)=>{
   state.createCalls.push({params:structuredClone(params),key:opts.idempotencyKey});
   let session=state.created.find(s=>s.key===opts.idempotencyKey);
   if(!session){session={id:'cs_'+(state.created.length+1),key:opts.idempotencyKey,status:'open',payment_status:'unpaid',livemode:true,currency:'mxn',amount_total:params.line_items[0].price_data.unit_amount,metadata:params.metadata,url:'https://checkout.stripe.com/c/pay/same'};state.created.push(session);state.sessions.set(session.id,session)}
   if(state.failAfterCreate){state.failAfterCreate=false;throw Error('timeout after remote success')}
   return structuredClone(session);
  }}};}
 }
 let handler;
 const context={Response,Request,URL,AbortSignal,Date,crypto:webcrypto,console:{error(){}},
  Deno:{env:{get:k=>k==='SUPABASE_SERVICE_ROLE_KEY'?'service':'public'},serve:h=>handler=h},
  stripeMode:()=>true,stripeKey:()=> 'fake-not-a-secret',accountColumn:()=> 'stripe_connect_live_account_id',
  requireClient:req=>{if(req.headers.get('x-dohoy-version')!=='5.1.0')throw Error('old client')},
  createClient:(url,key)=>key==='service'?admin:{auth:{getUser:async()=>({data:{user:state.user?{id:state.user}:null},error:null})}},
  Stripe,fetch:async()=>Response.json({id:'acct_worker',livemode:true,metadata:{supabase_user_id:state.accountOwner},configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:state.capability}}}}}})
 };
 vm.runInNewContext(source,context);
 state.call=async(extra={})=>{const req=new Request('https://example.test',{method:'POST',headers:{authorization:'Bearer fake','x-dohoy-version':'5.1.0','content-type':'application/json',...extra.headers},body:JSON.stringify({task_id:taskId,...extra.body})});const r=await handler(req);return {status:r.status,body:await r.json()}};
 return state;
}
test('exact 15% split and safe repeated checkout',async()=>{
 const f=fixture();const first=await f.call();assert.equal(first.status,200);assert.equal(first.body.commission_amount,15);assert.equal(first.body.worker_net_amount,85);
 const second=await f.call();assert.equal(second.status,200);assert.equal(second.body.reused,true);assert.equal(second.body.payment_id,first.body.payment_id);assert.equal(f.db.task_payments.length,1);assert.equal(f.created.length,1);
});
test('accepted counteroffer defines the price and centavos balance',async()=>{
 const f=fixture();Object.assign(f.db.task_offers[0],{counter_status:'accepted',counter_amount:140.33});const r=await f.call();assert.equal(r.status,200);assert.equal(r.body.amount_total,140.33);assert.equal(r.body.commission_amount,21.05);assert.equal(r.body.worker_net_amount,119.28);
});
test('timeout after Stripe creation recovers identical request/key without another charge session',async()=>{
 const f=fixture({failAfterCreate:true});assert.equal((await f.call()).status,503);assert.equal(f.db.task_payments[0].payment_status,'pending');
 assert.equal((await f.call()).status,200);assert.equal(f.db.task_payments.length,1);assert.equal(f.created.length,1);assert.equal(f.createCalls[0].key,f.createCalls[1].key);assert.deepEqual(f.createCalls[0].params,f.createCalls[1].params);
});
test('database save failure recovers the same remote session',async()=>{
 const f=fixture({failSave:true});assert.equal((await f.call()).status,503);assert.equal((await f.call()).status,200);assert.equal(f.created.length,1);assert.equal(f.db.task_payments.length,1);
});
test('concurrent clicks reserve just one payment',async()=>{
 const f=fixture();const results=await Promise.all([f.call(),f.call()]);assert.ok(results.some(r=>r.status===200));assert.ok(results.every(r=>[200,409].includes(r.status)));assert.equal(f.db.task_payments.length,1);assert.equal(f.created.length,1);
});
test('declined card keeps the open session recoverable; completion blocks another checkout',async()=>{
 const f=fixture();await f.call();f.db.task_payments[0].payment_status='failed';assert.equal((await f.call()).body.reused,true);assert.equal(f.created.length,1);
 Object.assign(f.created[0],{status:'complete',payment_status:'paid'});assert.equal((await f.call()).status,409);assert.equal(f.created.length,1);
});
test('only an expired session permits a replacement',async()=>{
 const f=fixture();await f.call();f.created[0].status='expired';assert.equal((await f.call()).status,200);assert.equal(f.created.length,2);assert.equal(f.db.task_payments[0].payment_status,'cancelled');
});
test('missing or inactive recipient, ownership mismatch and suspension block collection',async()=>{
 for(const option of ['missing','inactive','owner','suspended']){
  const f=fixture();if(option==='missing')f.db.profiles[1].stripe_connect_live_account_id=null;if(option==='inactive')f.capability='pending';if(option==='owner')f.accountOwner='someone_else';if(option==='suspended')f.db.profiles[0].is_suspended=true;
  assert.ok([403,409].includes((await f.call()).status));assert.equal(f.created.length,0);assert.equal(f.db.task_payments.length,0);
 }
});
test('invalid auth, another payer, stale app and cross-mode task are rejected',async()=>{
 for(const option of ['auth','payer','app','mode']){
  const f=fixture();if(option==='auth')f.user=null;if(option==='payer')f.user='someone_else';if(option==='mode')f.db.task_payments.push({task_id:taskId,stripe_livemode:false});
  const r=await f.call(option==='app'?{headers:{'x-dohoy-version':'old'}}:{});assert.ok([401,403,409].includes(r.status));assert.equal(f.created.length,0);
 }
});
test('ambiguous old reservation and expired idempotency window never create replacement',async()=>{
 for(const option of ['old','aged']){
  const f=fixture({failAfterCreate:true});await f.call();if(option==='old')f.db.task_payments[0].metadata={};else f.db.task_payments[0].created_at='2020-01-01';
  assert.equal((await f.call()).status,409);assert.equal(f.created.length,1);
 }
});
test('offer read failure cannot fall back to a potentially wrong price, and tiny amounts are blocked',async()=>{
 const failed=fixture({queryFailure:true});assert.equal((await failed.call()).status,503);assert.equal(failed.created.length,0);
 const tiny=fixture();tiny.db.task_offers[0].amount=0.01;assert.equal((await tiny.call()).status,409);assert.equal(tiny.db.task_payments.length,0);
});
