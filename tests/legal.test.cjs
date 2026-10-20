const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');const main=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).sort((a,b)=>b.length-a.length)[0].replace(/\ninit\(\);\s*$/,'');
const template=JSON.parse(fs.readFileSync('legal/documents.json','utf8'));
function app({published=false,user=false,fail=false}={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://www.dohoy.com.mx',runScripts:'outside-only'});const w=dom.window;
 const release={...structuredClone(template),id:'11111111-1111-4111-8111-111111111111',status:'published',content_sha256:'snapshot',published_at:'2026-10-20T00:00:00Z',operator:{legal_name:'Operador de pruebas',entity_type:'Persona física',address:'Dirección de pruebas',email:'qa@dohoy.invalid',phone:'8711234567'}};
 const db={legal_releases:published?[release]:[],legal_acceptances:[]};const rpcCalls=[];
 class Query{constructor(table){this.table=table;this.filters=[];this.singleResult=false}select(){return this}eq(k,v){this.filters.push(r=>r[k]===v);return this}order(){return this}limit(){return this}maybeSingle(){this.singleResult=true;return this}then(a,b){let data=db[this.table]||[];data=data.filter(r=>this.filters.every(f=>f(r)));return Promise.resolve({data:this.singleResult?(data[0]||null):data,error:fail?{message:'offline'}:null}).then(a,b)}}
 const client={from:t=>new Query(t),rpc:async(name,args)=>{rpcCalls.push({name,args});if(name==='accept_legal_release'){if(args.p_release_id!==release.id||!published||!args.p_terms||!args.p_privacy||(args.p_audience==='worker'&&!args.p_worker))return {error:{message:'invalid acceptance'}};const a={release_id:release.id,user_id:'user',audience:args.p_audience,content_sha256:release.content_sha256,accepted_at:'2026-10-20T01:00:00Z'};db.legal_acceptances.push(a);return {data:a,error:null}}return {data:null,error:null}}};
 w.supabase={createClient:()=>client};w.matchMedia=()=>({matches:false,addEventListener(){}});w.scrollTo=()=>{};w.fetch=async()=>{throw Error('offline')};
 w.eval(['legal-documents.js','legal.js','services.js','professions.js'].map(p=>fs.readFileSync(p,'utf8')).join('\n')+'\n'+main+'\nwindow.qa={state,render,signup,legalCenter,legalDocument,openLegalDocument,loadLegalStatus,legalHasAccepted,legalConsentFields,legalBodyHtml,legalDocumentUrl,prepareSignupLegal,openLegalAcceptance,submitLegalAcceptance,ensureLegalForCheckout,consumeLegalLink};');
 const qa=w.qa;qa.state.splash=false;qa.state.online=true;if(user){qa.state.user={id:'user'};qa.state.session={user:{id:'user'}};qa.state.profile={id:'user',full_name:'Usuario',is_admin:false};}
 return {w,qa,db,release,rpcCalls};
}
test('guest can open the six-document center and privacy without being sent to login',async()=>{
 const {w,qa}=app();qa.state.route='legalCenter';await qa.legalCenter();assert.equal(w.document.querySelectorAll('.legal-document-card').length,6);assert.match(w.document.body.textContent,/Documentos en preparación/);assert.equal(w.document.querySelector('form#legalConsentForm'),null);
 qa.state.route='legalDocument';qa.state.legalDocSlug='privacy';await qa.legalDocument();assert.match(w.document.body.textContent,/Aviso de privacidad/);assert.match(w.document.body.textContent,/Dato del operador pendiente/);assert.equal(qa.state.route,'legalDocument');assert.ok(w.document.querySelector('.legal-copy h3'));assert.ok(w.document.querySelector('.legal-copy p'));
});
test('drafts never expose acceptance inputs or create consent',async()=>{
 const {w,qa,rpcCalls}=app({user:true});await qa.loadLegalStatus(true);assert.doesNotMatch(qa.legalConsentFields('qa','worker'),/type="checkbox"/);assert.equal(qa.legalHasAccepted(),false);await assert.rejects(qa.ensureLegalForCheckout('task'),/completando/);assert.equal(rpcCalls.length,0);
});
test('published registration requires explicit unchecked terms/privacy and worker condition',async()=>{
 const {w,qa}=app({published:true});qa.state.route='signup';qa.state.initialMode='worker';w.document.getElementById('root').innerHTML=qa.signup();await qa.prepareSignupLegal();
 const fields=[...w.document.querySelectorAll('#signupLegal input[type=checkbox]')];assert.equal(fields.length,3);assert.ok(fields.every(f=>f.required&&!f.checked));assert.equal(w.document.getElementById('signupBtn').disabled,false);assert.equal(new w.URL(w.document.querySelector('#signupLegal a').href).searchParams.get('legal_release'),'11111111-1111-4111-8111-111111111111');
});
test('accepted role and exact hash control the banner; worker does not inherit client acceptance',async()=>{
 const {qa,db,release}=app({published:true,user:true});db.legal_acceptances.push({user_id:'user',release_id:release.id,audience:'client',content_sha256:release.content_sha256});await qa.loadLegalStatus(true);assert.equal(qa.legalHasAccepted('client'),true);assert.equal(qa.legalHasAccepted('worker'),false);db.legal_acceptances[0].content_sha256='old';await qa.loadLegalStatus(true);assert.equal(qa.legalHasAccepted('client'),false);
});
test('acceptance form sends the selected immutable release and explicit booleans, not a user ID or date',async()=>{
 const {w,qa,rpcCalls}=app({published:true,user:true});await qa.openLegalAcceptance('worker');const form=w.document.getElementById('legalConsentForm');for(const f of form.querySelectorAll('input[type=checkbox]'))f.checked=true;form.reportValidity=()=>true;
 await qa.submitLegalAcceptance({preventDefault(){},target:form},'worker');const call=rpcCalls.find(c=>c.name==='accept_legal_release');assert.equal(call.args.p_worker,true);assert.equal(call.args.p_audience,'worker');assert.equal(call.args.p_release_id,'11111111-1111-4111-8111-111111111111');assert.equal('user_id' in call.args,false);assert.equal('accepted_at' in call.args,false);
});
test('operator and document content render as text, preserving heading paragraphs and blocking script markup',()=>{
 const {w,qa}=app();w.document.getElementById('root').innerHTML=qa.legalBodyHtml('## Responsable\n{{legal_name}}\n\n<script>alert(1)</script>',{legal_name:'<img src=x onerror=alert(1)>'});assert.equal(w.document.querySelector('script'),null);assert.equal(w.document.querySelector('img'),null);assert.equal(w.document.querySelector('h3').textContent,'Responsable');assert.match(w.document.querySelector('p').textContent,/<img/);
});
test('document-load failures keep registration and checkout from claiming valid consent',async()=>{
 const {w,qa}=app({published:true,fail:true});qa.state.route='signup';w.document.getElementById('root').innerHTML=qa.signup();await qa.prepareSignupLegal();assert.equal(w.document.getElementById('signupBtn').disabled,true);assert.match(w.document.body.textContent,/No pudimos consultar/);await assert.rejects(qa.ensureLegalForCheckout('task'),/No pudimos consultar/);
});
test('public deep links preserve the requested document or center through the auth guard',()=>{
 const {w,qa}=app();w.history.replaceState({},'','/?legal=privacy');assert.equal(qa.consumeLegalLink(),true);assert.equal(qa.state.route,'legalDocument');assert.equal(qa.state.legalDocSlug,'privacy');w.history.replaceState({},'','/?legal=center');assert.equal(qa.consumeLegalLink(),true);assert.equal(qa.state.route,'legalCenter');
});
