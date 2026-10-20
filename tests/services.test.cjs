const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
const main=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).sort((a,b)=>b.length-a.length)[0].replace(/\ninit\(\);\s*$/,'');
function app(){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://www.dohoy.com.mx',runScripts:'outside-only'});
 const w=dom.window;w.supabase={createClient:()=>({rpc:async()=>({data:null,error:null})})};w.matchMedia=()=>({matches:false,addEventListener(){}});w.scrollTo=()=>{};w.fetch=async()=>{throw Error('offline')};
 w.eval(fs.readFileSync('legal-documents.js','utf8')+'\n'+fs.readFileSync('legal.js','utf8')+'\n'+fs.readFileSync('services.js','utf8')+'\n'+fs.readFileSync('professions.js','utf8')+'\n'+main+'\nwindow.qa={state,SERVICE_TYPES,createTask,publishServiceKind,changePublishService,paymentActionHtml,taskMinimumPrice,nextServiceVisitDate,serviceEditFields};');
 w.qa.state.user={id:'client'};w.qa.state.profile={id:'client',full_name:'Cliente',is_admin:false};w.qa.state.splash=false;return {w,qa:w.qa};
}
test('three publication modes keep their own categories, fields and price rules',()=>{
 const {w,qa}=app();
 for(const kind of ['daily','project','recurring']){
  qa.state.publishServiceKind=kind;qa.createTask();
  assert.equal(qa.publishServiceKind(),kind);
  assert.equal(w.document.getElementById('taskPriceInput').min,{daily:'100',project:'0',recurring:'10'}[kind]);
  assert.equal(w.document.getElementById('recurringSchedule').hidden,kind!=='recurring');
  assert.equal(w.document.getElementById('taskFrequency').required,kind==='recurring');
  assert.equal(w.document.getElementById('taskPriceInput').required,kind!=='project');
  const cat=w.document.getElementById('taskCategoryHidden').value;
  assert.ok(qa.SERVICE_TYPES[kind].categories.includes(cat));
 }
});
test('switching service mode resets incompatible category and recurrence fields',()=>{
 const {w,qa}=app();qa.createTask();qa.changePublishService('recurring');
 assert.equal(w.document.getElementById('taskCategoryHidden').value,'Limpieza');
 qa.changePublishService('project');assert.equal(w.document.getElementById('recurringSchedule').hidden,true);
 assert.equal(w.document.getElementById('taskPriceInput').required,false);
});
test('monthly visit clamps month end and preserves time; overdue visits stay in future',()=>{
 const {qa}=app();
 for(const [source,expected] of [['2027-01-31T15:45:00Z','2027-02-28T15:45:00.000Z'],['2028-01-31T15:45:00Z','2028-02-29T15:45:00.000Z']]){
  assert.equal(qa.nextServiceVisitDate({scheduled_for:source,recurrence_frequency:'monthly'},new Date('2026-10-19')).toISOString(),expected);
 }
 const late=qa.nextServiceVisitDate({scheduled_for:'2026-08-31T15:45:00Z',recurrence_frequency:'monthly'},new Date('2026-10-19T17:00:00Z'));
 assert.equal(late.toISOString(),'2026-10-20T15:45:00.000Z');
});
test('refunded and completed tasks never render a new pay button; read failure blocks checkout',()=>{
 const {qa}=app();const t={id:'task',client_id:'client',worker_id:'worker',status:'completed',offered_price:100};
 for(const payment_status of ['paid','refunded','partially_refunded']){
  qa.state.currentPayment={payment_status,amount_total:100,commission_amount:15,worker_net_amount:85,refunded_amount:20};
  assert.doesNotMatch(qa.paymentActionHtml(t,null),/id="payTaskButton"/);
 }
 qa.state.currentPayment=null;qa.state.paymentLoadError='No pudimos verificar el pago.';t.status='assigned';
 assert.doesNotMatch(qa.paymentActionHtml(t,null),/id="payTaskButton"/);
 qa.state.paymentLoadError='';qa.state.currentPayment={payment_status:'processing',amount_total:100};
 assert.match(qa.paymentActionHtml(t,null),/Continuar pago/);
});
test('all inline and external scripts parse',()=>{
 for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(match[1]);
 for(const f of ['services.js','professions.js','sw.js','legal.js','legal-documents.js'])new vm.Script(fs.readFileSync(f,'utf8'));
});
