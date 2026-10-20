/* Legal content is plain text. Only an authenticated user can accept a published snapshot. */
const LEGAL_SLUGS=['terms','worker','privacy','payments','safety','agreement'];
let legalFetchPromise=null;
function legalCurrent(){return state.legalRelease||LEGAL_DRAFT}
function legalIsPublished(r=legalCurrent()){return r?.status==='published'&&!!r.id}
function legalRole(){return state.mode==='worker'?'worker':'client'}
function legalHasAccepted(role=legalRole()){return legalIsPublished()&&(state.legalAccepted||[]).some(a=>a.audience===role&&a.release_id===state.legalRelease.id&&a.content_sha256===state.legalRelease.content_sha256)}
function legalTokens(text,operator={}){return String(text||'').replace(/\{\{([a-z_]+)\}\}/g,(_,key)=>String(operator[key]||'[Dato del operador pendiente]'))}
function legalBodyHtml(body,operator){return legalTokens(body,operator).split(/\n\s*\n/).map(p=>{if(!p.startsWith('## '))return `<p>${escapeHtml(p).replace(/\n/g,'<br>')}</p>`;const [heading,...copy]=p.split('\n');return `<h3>${escapeHtml(heading.slice(3))}</h3>${copy.length?`<p>${escapeHtml(copy.join('\n')).replace(/\n/g,'<br>')}</p>`:''}`}).join('')}
function legalDocumentUrl(slug,releaseId=null){const u=new URL(REDIRECT_URL);u.searchParams.set('legal',LEGAL_SLUGS.includes(slug)?slug:'terms');if(releaseId)u.searchParams.set('legal_release',releaseId);return u.toString()}
function legalLink(slug,title,release=legalCurrent()){return `<a href="${escapeAttr(legalDocumentUrl(slug,release.id))}" target="_blank" rel="noopener">${escapeHtml(title)}</a>`}
function legalBack(){if(state.user)go('profile');else go('welcome')}
function legalHeader(title){return `<div class="account-top"><button class="icon" aria-label="Volver" onclick="legalBack()">←</button><h1>${escapeHtml(title)}</h1><button class="icon" aria-label="Centro legal" onclick="go('legalCenter')">${iconSvg('document')}</button></div>`}
async function loadLegalStatus(force=false){
 if(legalFetchPromise)return legalFetchPromise;
 if(!force&&Date.now()-(state.legalFetchedAt||0)<20000)return;
 const uid=state.user?.id;
 legalFetchPromise=(async()=>{
  try{
   const {data,error}=await sb.from('legal_releases').select('id,version,status,operator,documents,content_sha256,published_at').eq('status','published').limit(1).maybeSingle();if(error)throw error;
   state.legalRelease=data||null;state.legalLoadError='';state.legalFetchedAt=Date.now();state.legalAccepted=[];
   if(uid&&data){const result=await sb.from('legal_acceptances').select('release_id,audience,content_sha256,accepted_at').eq('user_id',uid).eq('release_id',data.id);if(result.error)throw result.error;if(state.user?.id===uid)state.legalAccepted=result.data||[]}
  }catch(err){state.legalLoadError='No pudimos consultar los documentos vigentes. Reintenta antes de aceptar o pagar.';state.legalFetchedAt=0;state.legalAccepted=[];}
 })().finally(()=>{legalFetchPromise=null});return legalFetchPromise;
}
function legalStatusHtml(release=legalCurrent()){
 if(state.legalLoadError)return `<div class="legal-status-note" role="alert">${escapeHtml(state.legalLoadError)}</div>`;
 return legalIsPublished(release)?`<p class="legal-version">Versión ${escapeHtml(release.version)} · Publicada el ${new Date(release.published_at).toLocaleDateString('es-MX')}</p>`:`<div class="legal-status-note"><b>Documentos en preparación</b><p>Puedes consultar los borradores. Todavía falta completar los datos del operador y revisar el contenido; estos borradores no se registran como aceptados.</p></div>`;
}
async function legalCenter(){
 const uid=state.user?.id;await loadLegalStatus(true);if(state.route!=='legalCenter')return;
 let history=[];if(uid){const r=await sb.from('legal_acceptances').select('release_id,audience,accepted_at,legal_releases(version)').eq('user_id',uid).order('accepted_at',{ascending:false}).limit(30);if(!r.error)history=r.data||[]}
 if(state.route!=='legalCenter'||state.user?.id!==uid)return;
 const r=legalCurrent();root.innerHTML=shell(`<section class="settings-page legal-page legal-center">${legalHeader('Centro legal')}<div class="legal-intro"><span>DOHOY</span><h2>Acuerdos claros para cada servicio.</h2><p>Consulta las condiciones, tus derechos y cómo se atienden los problemas.</p></div>${legalStatusHtml(r)}<div class="legal-document-grid">${r.documents.map(d=>`<button class="legal-document-card" onclick="openLegalDocument(${jsArg(d.slug)})"><span>${iconSvg(d.slug==='privacy'?'shield':'document')}</span><b>${escapeHtml(d.title)}</b><p>${escapeHtml(d.summary)}</p><small>Leer documento →</small></button>`).join('')}</div>${state.user&&legalIsPublished()&&!state.legalLoadError?`<section class="legal-accept-panel"><h3>${legalHasAccepted()?'Tu aceptación está registrada':'Revisa las condiciones de tu cuenta'}</h3><p>${legalHasAccepted()?'Puedes volver a consultar la versión que aceptaste.':'Acepta las condiciones correspondientes a tu modo de uso antes de contratar o recibir pagos.'}</p>${!legalHasAccepted()?`<button class="btn primary" onclick="openLegalAcceptance()">Revisar y aceptar</button>`:''}</section>`:''}${history.length?`<section class="legal-history"><h3>Mis versiones aceptadas</h3>${history.map(a=>`<button onclick="openLegalDocument('terms',${jsArg(a.release_id)})"><span><b>${escapeHtml(a.legal_releases?.version||'Versión anterior')}</b><small>${a.audience==='worker'?'Trabajador':'Cliente'} · ${new Date(a.accepted_at).toLocaleString('es-MX')}</small></span><em>Consultar ›</em></button>`).join('')}</section>`:''}${adminAllowed()?`<button class="btn ghost legal-admin-entry" onclick="go('legalAdmin')">Administrar documentos y operador</button>`:''}</section>`,!!state.user);
}
function openLegalDocument(slug,releaseId=null){if(!LEGAL_SLUGS.includes(slug))return;state.legalDocSlug=slug;state.legalDocumentReleaseId=releaseId;go('legalDocument')}
async function legalDocument(){
 const slug=state.legalDocSlug||'terms',releaseId=state.legalDocumentReleaseId;await loadLegalStatus();let r=legalCurrent();
 if(releaseId&&r.id!==releaseId){const result=await sb.from('legal_releases').select('id,version,status,operator,documents,content_sha256,published_at').eq('id',releaseId).maybeSingle();if(result.error||!result.data){if(state.route==='legalDocument')root.innerHTML=shell(`<section class="settings-page legal-page">${legalHeader('Documento')}<p>No pudimos consultar esta versión. Reintenta desde el Centro legal.</p></section>`,!!state.user);return}r=result.data}
 if(state.route!=='legalDocument'||state.legalDocSlug!==slug)return;const d=r.documents.find(d=>d.slug===slug);if(!d)return;
 const status=r.status==='retired'?`<p class="legal-version">Versión histórica ${escapeHtml(r.version)}. Se conserva para consulta.</p>`:legalStatusHtml(r);
 root.innerHTML=shell(`<section class="settings-page legal-page legal-reader">${legalHeader(d.title)}<h2 class="settings-title">${escapeHtml(d.title)}</h2>${status}<article class="legal-copy">${legalBodyHtml(d.body,r.operator)}</article><button class="btn ghost" onclick="go('legalCenter')">Ver todos los documentos</button></section>`,!!state.user);
}
function legalConsentFields(prefix,role,release=legalCurrent()){
 if(!legalIsPublished(release))return `<p class="legal-form-note">Consulta el ${legalLink('terms','borrador de términos',release)} y el ${legalLink('privacy','aviso de privacidad en preparación',release)}. La aceptación se solicitará cuando exista una versión definitiva.</p>`;
 return `<input name="legal_release_id" type="hidden" value="${escapeAttr(release.id)}"><input name="legal_audience" type="hidden" value="${role}"><div class="legal-consent-fields"><label for="${prefix}Terms"><input id="${prefix}Terms" type="checkbox" name="legal_terms" required><span>Acepto los ${legalLink('terms','términos de uso',release)}, las ${legalLink('payments','reglas de pagos y cancelaciones',release)}, las ${legalLink('safety','reglas de seguridad',release)} y el ${legalLink('agreement','acuerdo por servicio',release)}.</span></label><label for="${prefix}Privacy"><input id="${prefix}Privacy" type="checkbox" name="legal_privacy" required><span>He leído el ${legalLink('privacy','aviso de privacidad',release)}. Esto no autoriza publicidad opcional.</span></label>${role==='worker'?`<label for="${prefix}Worker"><input id="${prefix}Worker" type="checkbox" name="legal_worker" required><span>Acepto las ${legalLink('worker','condiciones para trabajadores',release)}. Consultaré los requisitos aplicables al servicio que ofrezca.</span></label>`:''}<small>Versión ${escapeHtml(release.version)}</small></div>`;
}
async function prepareSignupLegal(){
 const host=document.getElementById('signupLegal'),btn=document.getElementById('signupBtn');if(!host)return;if(btn)btn.disabled=true;
 await loadLegalStatus(true);if(!host.isConnected||state.route!=='signup')return;host.innerHTML=state.legalLoadError?`<p class="legal-form-note" role="alert">${escapeHtml(state.legalLoadError)}</p><button type="button" class="btn ghost" onclick="prepareSignupLegal()">Reintentar</button>`:legalConsentFields('signup',state.initialMode==='worker'?'worker':'client');if(btn)btn.disabled=!!state.legalLoadError;
}
async function recordSignupLegal(form){
 const f=new FormData(form),id=f.get('legal_release_id');if(!id||!state.user)return;
 const {error}=await sb.rpc('accept_legal_release',{p_release_id:id,p_audience:f.get('legal_audience'),p_terms:f.get('legal_terms')==='on',p_privacy:f.get('legal_privacy')==='on',p_worker:f.get('legal_worker')==='on',p_source:'signup'});
 if(error){state.legalAccepted=[];return}await loadLegalStatus(true);
}
async function openLegalAcceptance(role=legalRole(),taskId=null){
 if(!state.user){go('signup');return}role=role==='worker'?'worker':'client';await loadLegalStatus(true);
 if(!legalIsPublished()||state.legalLoadError){go('legalCenter');return}
 openProfileSheet('Condiciones de tu cuenta','Lee los documentos y confirma tu elección. La aceptación se registra para esta versión.',`<form id="legalConsentForm" class="profile-inline-form" onsubmit="submitLegalAcceptance(event,${jsArg(role)},${taskId?jsArg(taskId):'null'})">${legalConsentFields('account',role)}<p id="legalConsentFeedback" role="status"></p><button class="btn primary" type="submit">Aceptar y continuar</button></form>`);
}
async function submitLegalAcceptance(e,role,taskId=null){
 e.preventDefault();const f=new FormData(e.target),btn=e.target.querySelector('button[type="submit"]'),note=document.getElementById('legalConsentFeedback');if(btn.disabled)return;if(!e.target.reportValidity())return;btn.disabled=true;
 try{const {error}=await sb.rpc('accept_legal_release',{p_release_id:f.get('legal_release_id'),p_audience:role,p_terms:f.get('legal_terms')==='on',p_privacy:f.get('legal_privacy')==='on',p_worker:f.get('legal_worker')==='on',p_source:taskId?'checkout':'account'});if(error)throw error;await loadLegalStatus(true);closeProfileSheet();if(taskId&&state.selectedTask?.id===taskId)startTaskCheckout(taskId);else{state.notice='Aceptación registrada para esta versión.';render()}}
 catch(err){if(note)note.textContent=String(err.message||'No pudimos registrar tu aceptación.');btn.disabled=false}
}
async function ensureLegalForCheckout(taskId){
 await loadLegalStatus(true);if(state.legalLoadError)throw Error(state.legalLoadError);
 if(!legalIsPublished())throw Error('Estamos completando las condiciones de contratación de DOHOY. Consulta el Centro legal antes de realizar un pago real.');
 if(!legalHasAccepted('client')){await openLegalAcceptance('client',taskId);return false}return true;
}
function legalAccountBanner(){return state.user&&legalIsPublished()&&!legalHasAccepted()&&!['legalCenter','legalDocument','legalAdmin'].includes(state.route)?`<aside class="legal-account-banner"><span>Hay condiciones que debes revisar para usar DOHOY como ${legalRole()==='worker'?'trabajador':'cliente'}.</span><button onclick="openLegalAcceptance()">Revisar</button></aside>`:''}
function consumeLegalLink(){const params=new URL(location.href).searchParams,slug=params.get('legal');if(slug==='center'){state.route='legalCenter';render();return true}if(!LEGAL_SLUGS.includes(slug))return false;state.legalDocSlug=slug;const id=params.get('legal_release');state.legalDocumentReleaseId=/^[0-9a-f-]{36}$/i.test(id||'')?id:null;state.route='legalDocument';render();return true}
async function legalAdmin(){
 if(!adminAllowed()){go('legalCenter');return}const result=await sb.from('legal_releases').select('*').order('created_at',{ascending:false}).limit(20);if(state.route!=='legalAdmin')return;
 if(result.error){root.innerHTML=shell(`<section class="settings-page legal-page">${legalHeader('Administrar documentos')}<p role="alert">No pudimos cargar los borradores.</p><button onclick="go('legalAdmin')">Reintentar</button></section>`,true);return}
 state.legalAdminReleases=result.data||[];state.legalEditing=state.legalAdminReleases.find(r=>r.status==='draft')||null;renderLegalAdmin();
}
function newLegalDraft(){const base=state.legalAdminReleases?.find(r=>r.status==='published')||LEGAL_DRAFT;state.legalEditing={...JSON.parse(JSON.stringify(base)),id:null,status:'draft',version:new Date().toISOString().replace(/[:.]/g,'-')};renderLegalAdmin()}
function renderLegalAdmin(){
 if(!adminAllowed())return;const r=state.legalEditing;if(!r){root.innerHTML=shell(`<section class="settings-page legal-page">${legalHeader('Administrar documentos')}<p>Las versiones publicadas se conservan sin cambios. Crea un borrador para preparar la siguiente.</p><button class="btn primary" onclick="newLegalDraft()">Crear otra versión</button></section>`,true);return}
 const op=r.operator||{};root.innerHTML=shell(`<section class="settings-page legal-page legal-admin">${legalHeader('Administrar documentos')}<h2>Operador y versión legal</h2><p>Guarda mientras preparas el contenido. Publicar vuelve la versión consultable y permite solicitar su aceptación.</p><div class="legal-status-note"><b>Preparación pendiente</b><p>Completa los datos reales del operador y valida el régimen laboral, fiscal y los proveedores de datos. Publicar documentos no implementa retenciones, seguros ni sustituye los contratos o registros que sean exigibles. Los borradores privados se muestran aquí; el público solo ve la versión publicada o los borradores informativos de la app.</p></div><form id="legalDraftForm" class="profile-inline-form" novalidate onsubmit="saveLegalDraft(event)"><label>Versión<input name="version" required maxlength="60" value="${escapeAttr(r.version)}"></label><label>Tipo de operador<select name="entity_type" required><option value="">Selecciona</option>${['Persona física','Persona moral'].map(v=>`<option ${op.entity_type===v?'selected':''}>${v}</option>`).join('')}</select></label>${[['legal_name','Nombre completo o razón social'],['address','Domicilio que se publicará'],['email','Correo de atención y privacidad'],['phone','Teléfono de atención']].map(([key,label])=>`<label>${label}<input type="${key==='email'?'email':key==='phone'?'tel':'text'}" name="${key}" required maxlength="${key==='address'?500:200}" value="${escapeAttr(op[key]||'')}"></label>`).join('')}<h3>Documentos de esta versión</h3><p>Los campos entre llaves se sustituyen con los datos del operador. Revisa cada documento antes de publicarlo.</p>${r.documents.map(d=>`<details class="legal-editor-document"><summary>${escapeHtml(d.title)}</summary><textarea name="body_${d.slug}" minlength="50" maxlength="40000" required rows="16">${escapeHtml(d.body)}</textarea></details>`).join('')}<p id="legalAdminFeedback" role="status"></p><div class="legal-admin-actions"><button class="btn primary" type="submit">Guardar borrador</button><button class="btn ghost" type="button" onclick="publishLegalDraft(this)">Publicar y solicitar aceptación</button></div></form></section>`,true);
}
async function saveLegalDraft(e=null){
 e?.preventDefault();if(state.legalSaveBusy)return null;const form=document.getElementById('legalDraftForm'),f=new FormData(form),r=state.legalEditing;state.legalSaveBusy=true;const note=document.getElementById('legalAdminFeedback');
 try{const operator=Object.fromEntries(['legal_name','entity_type','address','email','phone'].map(k=>[k,String(f.get(k)||'').trim()]));const documents=r.documents.map(d=>({...d,body:String(f.get('body_'+d.slug)||'')}));const {data,error}=await sb.rpc('save_legal_draft',{p_release_id:r.id||null,p_version:String(f.get('version')||'').trim(),p_operator:operator,p_documents:documents});if(error)throw error;state.legalEditing=Array.isArray(data)?data[0]:data;note.textContent='Borrador guardado. Todavía no se solicita su aceptación.';return state.legalEditing}
 catch(err){note.textContent=String(err.message||'No pudimos guardar el borrador.');return null}finally{state.legalSaveBusy=false}
}
async function publishLegalDraft(btn){
 const form=document.getElementById('legalDraftForm');if(!form.reportValidity()||btn.disabled)return;btn.disabled=true;
 try{const draft=await saveLegalDraft();if(!draft)return;const {error}=await sb.rpc('publish_legal_release',{p_release_id:draft.id});if(error)throw error;await loadLegalStatus(true);state.notice='Versión publicada. Cada usuario deberá aceptar por sí mismo.';go('legalCenter')}
 catch(err){document.getElementById('legalAdminFeedback').textContent=String(err.message||err)}finally{btn.disabled=false}
}
async function openServiceAgreement(taskId){
 const {data,error}=await sb.from('service_agreements').select('*').eq('task_id',taskId).maybeSingle();if(error){state.error='No pudimos consultar el acuerdo.';render();return}
 if(!data){openProfileSheet('Registro del acuerdo','Este servicio no tiene un registro versionado del acuerdo.',`<p>Puedes consultar la propuesta aceptada y los detalles de la tarea. No se atribuye una aceptación nueva a servicios anteriores.</p>`);return}
 const s=data.snapshot;openProfileSheet('Acuerdo del servicio',s.title,`<div class="legal-service-snapshot"><p><b>Cliente (nombre de perfil)</b><br>${escapeHtml(s.client_name||'Cliente')}</p><p><b>Prestador (nombre de perfil)</b><br>${escapeHtml(s.worker_name||'Prestador')}</p><p><b>Precio acordado</b><br>${moneyExact(s.amount)} MXN</p><p><b>Descripción</b><br>${escapeHtml(s.description||'')}</p>${[['Alcance',s.quote_scope],['Materiales',s.quote_materials],['Tiempo',s.quote_timeline],['Etapas',s.quote_stages],['Frecuencia por visita',s.recurrence_frequency?SERVICE_FREQUENCIES[s.recurrence_frequency]:null]].filter(([,v])=>v).map(([label,value])=>`<p><b>${label}</b><br>${escapeHtml(value)}</p>`).join('')}<p>Registrado el ${new Date(data.recorded_at).toLocaleString('es-MX')}.</p>${data.release_id?legalLink('agreement','Consultar condiciones de esa versión',{id:data.release_id}):'<p>En esa fecha no había una versión general publicada.</p>'}<p>Este registro no sustituye los contratos específicos que sean exigibles para la actividad.</p></div>`);
}
