/* Permanent professional profiles. Billing is deliberately a separate future step. */
const PROFESSIONS=[
 {id:'medicine',title:'Medicina',person:'Médico',category:'Medicina',group:'Salud',icon:'medical'},
 {id:'nursing',title:'Enfermería',person:'Enfermería',category:'Enfermería',group:'Salud',icon:'care'},
 {id:'veterinary',title:'Veterinaria',person:'Veterinario',category:'Veterinaria',group:'Salud',icon:'Mascotas'},
 {id:'architecture',title:'Arquitectura',person:'Arquitecto',category:'Arquitectura',group:'Construcción',icon:'architecture'},
 {id:'engineering',title:'Ingeniería civil',person:'Ingeniero civil',category:'Ingeniería civil',group:'Construcción',icon:'architecture'},
 {id:'masonry',title:'Albañilería',person:'Albañil',category:'Albañilería',group:'Construcción',icon:'masonry'},
 {id:'plumbing',title:'Plomería',person:'Plomero',category:'Plomería',group:'Construcción',icon:'tools'},
 {id:'electrical',title:'Electricidad',person:'Electricista',category:'Electricidad',group:'Construcción',icon:'bolt'},
 {id:'painting',title:'Pintura',person:'Pintor',category:'Pintura',group:'Construcción',icon:'paint'},
 {id:'carpentry',title:'Carpintería',person:'Carpintero',category:'Carpintería',group:'Construcción',icon:'tools'},
 {id:'cleaning',title:'Limpieza',person:'Limpieza',category:'Limpieza',group:'Hogar',icon:'Hogar'},
 {id:'gardening',title:'Jardinería',person:'Jardinero',category:'Jardinería',group:'Hogar',icon:'leaf'},
 {id:'air_conditioning',title:'Climatización',person:'Técnico en climatización',category:'Climatización',group:'Hogar',icon:'air'},
 {id:'technology',title:'Tecnología',person:'Técnico en tecnología',category:'Tecnología',group:'Otros',icon:'Tecnología'},
 {id:'accounting',title:'Contabilidad',person:'Contador',category:'Contabilidad',group:'Otros',icon:'document'},
 {id:'legal',title:'Asesoría legal',person:'Abogado',category:'Asesoría legal',group:'Otros',icon:'legal'}
];
SERVICE_TYPES.project.categories=[...new Set([...PROFESSIONS.map(p=>p.category),...SERVICE_TYPES.project.categories])];
function professionById(id){return PROFESSIONS.find(p=>p.id===id)}
function professionError(message){return Object.assign(new Error(message),{professionalMessage:true})}
function professionErrorText(error){return error?.professionalMessage?error.message:friendlyError(error?.message||error)}
function reportProfessionError(error){state.error=professionErrorText(error);state.notice='';render()}
function professionFold(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()}
function professionIcon(p){
 const s='fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
 const paths={medical:`<path ${s} d="M5 3v5a5 5 0 0 0 10 0V3M3 3h4m6 0h4M10 13v3a4 4 0 0 0 8 0v-2"/><circle ${s} cx="18" cy="11" r="3"/>`,care:`<path ${s} d="M12 20s-8-5-8-10a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5-8 10-8 10Z"/><path ${s} d="M9 12h6m-3-3v6"/>`,architecture:`<path ${s} d="m4 20 8-16 8 16H4ZM9 13h6M12 4v9"/><path ${s} d="m4 20 3-6m13 6-3-6"/>`,masonry:`<rect ${s} x="3" y="5" width="18" height="14" rx="2"/><path ${s} d="M3 12h18M12 5v7M8 12v7m8-7v7"/>`,paint:`<rect ${s} x="3" y="4" width="14" height="6" rx="2"/><path ${s} d="M17 7h3v6H11v7M9 20h4"/>`,air:`<path ${s} d="M3 8h13a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7"/>`,legal:`<path ${s} d="M12 3v18M5 21h14M4 7h16M6 7l-3 7h6L6 7Zm12 0-3 7h6l-3-7Z"/>`};
 return paths[p.icon]?svgWrap(paths[p.icon]):iconSvg(p.icon);
}
function professionalHeader(title,back){return `<div class="top professional-top"><button class="icon" aria-label="Volver" onclick="go('${back}')">←</button><b>${escapeHtml(title)}</b><button class="icon" aria-label="Mi perfil profesional" onclick="go('professionalEditor')">${iconSvg('user')}</button></div>`}
function openProfessionCatalog(){state.professionQuery='';state.professionGroup='Todas';go('professionCatalog')}
async function professionCatalog(){
 const uid=state.user?.id,city=state.professionCity||'',request=state.professionLoadToken=(state.professionLoadToken||0)+1;
 root.innerHTML=shell(`<section class="screen professional-screen">${professionalHeader('Servicios y proyectos','clientHome')}<p role="status">Cargando profesiones…</p></section>`,true);
 let response;try{response=await sb.rpc('professional_directory_counts',{p_city:city||null})}catch(err){response={error:err}}
 if(state.route!=='professionCatalog'||state.user?.id!==uid||request!==state.professionLoadToken)return;
 state.professionCounts=response.error?null:{...Object.fromEntries(PROFESSIONS.map(p=>[p.id,0])),...Object.fromEntries((response.data||[]).map(x=>[x.profession_id,Number(x.available_count)]))};
 const failure=response.error?`<div class="professional-feedback" role="alert">No pudimos consultar los disponibles. Revisa tu conexión. <button type="button" onclick="go('professionCatalog')">Reintentar</button></div>`:'';
 root.innerHTML=shell(`<section class="screen professional-screen">${professionalHeader('Servicios y proyectos','clientHome')}${authMsg()}
 <div class="professional-intro"><span class="professional-eyebrow">ENCUENTRA A QUIEN SABE</span><h1>¿Qué profesional necesitas?</h1><p>Explora por profesión, conoce su trabajo y solicita una cotización.</p></div>
 <form class="professional-city-filter" onsubmit="setProfessionCity(event)"><label for="professionCity">Ciudad o zona de atención</label><div><input id="professionCity" name="city" maxlength="80" value="${escapeAttr(city)}" placeholder="Ej. Torreón" autocomplete="address-level2"><button type="submit">Buscar</button></div></form>
 <div class="professional-search">${iconSvg('search')}<input id="professionSearch" aria-label="Buscar profesión" placeholder="Médico, enfermería, arquitecto…" value="${escapeAttr(state.professionQuery||'')}" oninput="filterProfessionCatalog(this.value)"></div>
 <div class="profession-groups" aria-label="Filtrar profesiones">${['Todas','Salud','Construcción','Hogar','Otros'].map(g=>`<button type="button" aria-pressed="${(state.professionGroup||'Todas')===g}" onclick="selectProfessionGroup(${jsArg(g)})">${g}</button>`).join('')}</div>
 ${failure}<div id="professionCards" class="profession-grid"></div>
 <button class="professional-general-request" onclick="startServicePublication('project')">${iconSvg('plus')} Publicar un proyecto para recibir cotizaciones <span>›</span></button>
 <div class="professional-register"><span>${iconSvg('briefcase')}</span><div><b>¿Ofreces un servicio?</b><p>Crea tu perfil y elige cuándo recibir solicitudes.</p></div><button onclick="go('professionalEditor')">Crear perfil</button></div>
 </section>`,true);filterProfessionCatalog(state.professionQuery||'');
}
function setProfessionCity(e){e.preventDefault();state.professionCity=String(new FormData(e.target).get('city')||'').trim();go('professionCatalog')}
function selectProfessionGroup(group){state.professionGroup=group;document.querySelectorAll('.profession-groups button').forEach(b=>b.setAttribute('aria-pressed',String(b.textContent===group)));filterProfessionCatalog(state.professionQuery||'')}
function filterProfessionCatalog(query){
 state.professionQuery=query;const folded=professionFold(query),group=state.professionGroup||'Todas',host=document.getElementById('professionCards');if(!host)return;
 const list=PROFESSIONS.filter(p=>(group==='Todas'||p.group===group)&&professionFold(`${p.title} ${p.person}`).includes(folded));
 host.innerHTML=list.length?list.map(p=>{const count=state.professionCounts?.[p.id];return `<button class="profession-card" onclick="openProfession(${jsArg(p.id)})"><span class="profession-card-icon group-${p.group==='Salud'?'health':p.group==='Hogar'?'home':'build'}">${professionIcon(p)}</span><b>${escapeHtml(p.title)}</b><small>${count==null?'Consultar disponibles':`${count} disponible${count===1?'':'s'}`}</small><span class="profession-card-arrow">↗</span></button>`}).join(''):`<p class="profession-no-match" role="status">No encontramos esa profesión. Puedes publicar una solicitud general.</p>`;
}
function openProfession(id){if(!professionById(id))return;state.selectedProfession=id;state.professionalList=[];state.professionalPage=0;state.professionalSearch='';state.professionAvailableOnly=true;go('professionalList')}
async function professionalList(){
 const uid=state.user?.id,id=state.selectedProfession,p=professionById(id);if(!p){go('professionCatalog');return}
 const page=Number(state.professionalPage||0),token=state.professionLoadToken=(state.professionLoadToken||0)+1;
 root.innerHTML=shell(`<section class="screen professional-screen">${professionalHeader(p.title,'professionCatalog')}<p role="status">Buscando perfiles…</p></section>`,true);
 let result;try{result=await sb.rpc('professional_directory',{p_profession_id:id,p_city:state.professionCity||null,p_available_only:state.professionAvailableOnly!==false,p_limit:25,p_offset:page*24})}catch(error){result={error}}
 if(state.route!=='professionalList'||state.user?.id!==uid||state.selectedProfession!==id||token!==state.professionLoadToken)return;
 let list=result.data||[];state.professionalHasMore=list.length>24;list=list.slice(0,24);
 if(!result.error)list=await Promise.all(list.map(resolveAvatar));
 if(state.route!=='professionalList'||state.user?.id!==uid||token!==state.professionLoadToken)return;
 state.professionalList=list;
 root.innerHTML=shell(`<section class="screen professional-screen">${professionalHeader(p.title,'professionCatalog')}${authMsg()}
 <div class="professional-intro"><span class="professional-eyebrow">SERVICIOS Y PROYECTOS</span><h1>${escapeHtml(p.title)}</h1><p>${state.professionCity?`En ${escapeHtml(state.professionCity)}`:'Perfiles publicados en DOHOY'} · Disponibilidad declarada por cada profesional.</p></div>
 <div class="professional-list-filters"><label><input type="checkbox" ${state.professionAvailableOnly!==false?'checked':''} onchange="setProfessionalAvailabilityFilter(this.checked)"> Solo disponibles</label><button onclick="go('professionCatalog')">Cambiar zona</button></div>
 <div class="professional-search">${iconSvg('search')}<input aria-label="Buscar entre los perfiles cargados" placeholder="Buscar en esta página" value="${escapeAttr(state.professionalSearch||'')}" oninput="filterProfessionalList(this.value)"></div>
 ${result.error?`<div class="professional-feedback" role="alert">No pudimos cargar los perfiles. <button onclick="go('professionalList')">Reintentar</button></div>`:''}<div id="professionalResults" class="professional-results"></div>
 ${page||state.professionalHasMore?`<div class="professional-pagination"><button ${page?'':'disabled'} onclick="changeProfessionalPage(-1)">Anterior</button><span>Página ${page+1}</span><button ${state.professionalHasMore?'':'disabled'} onclick="changeProfessionalPage(1)">Siguiente</button></div>`:''}
 <button class="professional-general-request" onclick="startServicePublication('project',${jsArg(p.category)})">${iconSvg('plus')} Publicar una solicitud de ${escapeHtml(p.title.toLowerCase())}<span>›</span></button></section>`,true);
 filterProfessionalList(state.professionalSearch||'',!!result.error);
}
function setProfessionalAvailabilityFilter(value){state.professionAvailableOnly=value;state.professionalPage=0;state.professionalSearch='';go('professionalList')}
function changeProfessionalPage(change){state.professionalPage=Math.max(0,(state.professionalPage||0)+change);state.professionalSearch='';go('professionalList')}
function filterProfessionalList(query,failed=false){
 state.professionalSearch=query;const host=document.getElementById('professionalResults');if(!host)return;
 const q=professionFold(query),list=(state.professionalList||[]).filter(p=>professionFold(`${profileDisplayName(p)} ${p.headline} ${p.city} ${p.service_area}`).includes(q));
 host.innerHTML=list.length?list.map(professionalCard).join(''):failed?'':`<div class="professional-empty">${iconSvg('users')}<h2>${q?'No hay coincidencias en esta página':'Aún no hay perfiles '+(state.professionAvailableOnly!==false?'disponibles':'publicados')}</h2><p>${q?'Prueba otro nombre o revisa la siguiente página.':'Puedes cambiar la zona o publicar tu solicitud para recibir propuestas.'}</p></div>`;
}
function professionalCard(p){const profession=professionById(p.profession_id);return `<article class="professional-card"><button class="professional-person" onclick="openProfessionalProfile(${jsArg(p.user_id)})">${avatarMarkup(p)}<span><h2>${escapeHtml(profileDisplayName(p))}</h2><small>${escapeHtml(profession?.person||'Profesional')}</small></span><span class="professional-status ${p.accepting_requests?'available':''}">${p.accepting_requests?'Disponible':'Sin disponibilidad'}</span></button><p class="professional-headline">${escapeHtml(p.headline)}</p><div class="professional-facts"><span>${iconSvg('location')} ${escapeHtml(p.city)}</span><span>${iconSvg('star')} ${Number(p.completed_tasks)>0?prettyRating(p.rating)+' · '+Number(p.completed_tasks)+' trabajos':'Sin trabajos calificados aún'}</span></div><div class="professional-card-actions"><button onclick="openProfessionalProfile(${jsArg(p.user_id)})">Ver perfil</button><button class="professional-quote" ${p.accepting_requests?'':'disabled'} onclick="requestProfessionalQuote(${jsArg(p.user_id)})">Solicitar cotización</button></div></article>`}
async function getProfessional(userId){const {data,error}=await sb.rpc('professional_directory',{p_user_id:userId,p_available_only:false,p_limit:1});if(error)throw error;return (data||[])[0]||null}
async function openProfessionalProfile(userId){
 const route=state.route,uid=state.user?.id;try{const p=await getProfessional(userId);if(state.route!==route||state.user?.id!==uid)return;if(!p)throw professionError('Este perfil ya no está publicado.');state.selectedTask=null;await openWorkerProfile(userId,'professionalList')}catch(err){if(state.route===route&&state.user?.id===uid)reportProfessionError(err)}
}
function professionalProfileInfoHtml(p){if(!p)return '';const profession=professionById(p.profession_id);return `<section class="professional-public-info"><span class="professional-status ${p.accepting_requests?'available':''}">${p.accepting_requests?'Recibe solicitudes':'No recibe solicitudes por ahora'}</span><h2>${escapeHtml(profession?.title||'Servicios profesionales')}</h2><h3>${escapeHtml(p.headline)}</h3><p>${escapeHtml(p.about)}</p><dl><div><dt>Zona de atención</dt><dd>${escapeHtml(p.city)}${p.service_area?' · '+escapeHtml(p.service_area):''}</dd></div>${p.years_experience!=null?`<div><dt>Experiencia declarada</dt><dd>${Number(p.years_experience)} años</dd></div>`:''}${p.license_number?`<div><dt>Cédula declarada · sin verificar</dt><dd>${escapeHtml(p.license_number)}</dd></div>`:''}</dl>${state.mode==='client'&&p.user_id!==state.user?.id?`<button class="professional-quote" ${p.accepting_requests?'':'disabled'} onclick="requestProfessionalQuote(${jsArg(p.user_id)})">Solicitar cotización</button>`:''}</section>`}
async function requestProfessionalQuote(userId){
 if(state.mode!=='client'){reportProfessionError(professionError('Cambia al modo cliente para solicitar una cotización.'));return}
 const route=state.route,uid=state.user?.id;try{const p=await getProfessional(userId);if(state.route!==route||state.user?.id!==uid)return;if(!p?.accepting_requests)throw professionError('Este profesional no recibe solicitudes por ahora.');if(p.user_id===uid)throw professionError('No puedes solicitar una cotización a tu propio perfil.');state.professionRequest=p;state.publishServiceKind='project';state.publishPrefillCategory=professionById(p.profession_id)?.category||'Otro';state.nextVisitDraft=null;go('createTask')}catch(err){if(state.route===route&&state.user?.id===uid)reportProfessionError(err)}
}
function professionalPublicationHeading(){const p=state.professionRequest;if(!p)return '';return `<input id="taskServiceKind" type="hidden" value="project"><input type="hidden" name="professional_id" value="${escapeAttr(p.user_id)}"><div class="professional-request-note">${iconSvg('users')}<div><b>Cotización para ${escapeHtml(profileDisplayName(p))}</b><p>Publicaremos tu solicitud y enviaremos una invitación a este profesional. Podrás comparar las propuestas antes de contratar.</p></div></div>`}
async function professionalEditor(){
 const uid=state.user?.id;root.innerHTML=shell(`<section class="screen professional-screen">${professionalHeader('Mi perfil profesional','profile')}<p role="status">Cargando tu perfil…</p></section>`,true);
 let data,error;try{({data,error}=await sb.from('professional_profiles').select('user_id,profession_id,headline,about,city,service_area,years_experience,license_number,accepting_requests,is_published').eq('user_id',uid).maybeSingle())}catch(e){error=e}
 if(state.route!=='professionalEditor'||state.user?.id!==uid)return;
 if(error){root.innerHTML=shell(`<section class="screen professional-screen">${professionalHeader('Mi perfil profesional','profile')}<div class="professional-feedback" role="alert">No pudimos consultar tu perfil. <button onclick="go('professionalEditor')">Reintentar</button></div></section>`,true);return}
 const p=data||{};state.ownProfessionalProfile=p;
 root.innerHTML=shell(`<section class="screen professional-screen">${professionalHeader('Mi perfil profesional','profile')}${authMsg()}<div class="professional-intro"><span class="professional-eyebrow">TU TRABAJO, TU PERFIL</span><h1>${data?'Tu perfil profesional':'Date a conocer'}</h1><p>Usaremos tu nombre, foto, calificaciones y portafolio de DOHOY. El perfil permanece publicado hasta que lo pauses.</p></div>
 <form id="professionalProfileForm" class="professional-editor" onsubmit="saveProfessionalProfile(event)"><div id="professionalProfileFeedback" class="professional-feedback" role="status" hidden></div>
 <label for="professionalProfession">Profesión u oficio</label><select id="professionalProfession" name="profession_id" required><option value="">Elige tu profesión</option>${PROFESSIONS.map(x=>`<option value="${x.id}" ${p.profession_id===x.id?'selected':''}>${escapeHtml(x.title)}</option>`).join('')}</select>
 <label for="professionalHeadline">Presentación breve</label><input id="professionalHeadline" name="headline" required minlength="3" maxlength="100" value="${escapeAttr(p.headline||'')}" placeholder="Ej. Remodelaciones y acabados de interiores">
 <label for="professionalAbout">¿Qué servicios ofreces?</label><textarea id="professionalAbout" name="about" required minlength="10" maxlength="1500" rows="4" placeholder="Describe lo que haces y qué incluye tu servicio">${escapeHtml(p.about||state.profile?.bio||'')}</textarea>
 <div class="professional-editor-columns"><div><label for="professionalCity">Ciudad</label><input id="professionalCity" name="city" required minlength="2" maxlength="80" value="${escapeAttr(p.city||'')}" placeholder="Ej. Torreón" autocomplete="address-level2"></div><div><label for="professionalYears">Años de experiencia <small>Opcional</small></label><input id="professionalYears" name="years_experience" type="number" min="0" max="80" step="1" value="${p.years_experience??''}"></div></div>
 <label for="professionalArea">Zona de atención <small>Opcional</small></label><input id="professionalArea" name="service_area" maxlength="160" value="${escapeAttr(p.service_area||'')}" placeholder="Ej. Torreón y Gómez Palacio"><p class="professional-field-note">Escribe zonas generales; tu domicilio y teléfono no aparecen en el catálogo.</p>
 <label for="professionalLicense">Cédula profesional <small>Si corresponde</small></label><input id="professionalLicense" name="license_number" maxlength="30" value="${escapeAttr(p.license_number||'')}" placeholder="Número de cédula"><p class="professional-field-note">Ingresarla no otorga una insignia de verificación.</p>
 <label class="professional-toggle"><input name="is_published" type="checkbox" ${!data||p.is_published?'checked':''}><span><b>Mostrar mi perfil en el catálogo</b><small>Puedes ocultarlo sin perder tus datos.</small></span></label>
 <label class="professional-toggle"><input name="accepting_requests" type="checkbox" ${!data||p.accepting_requests?'checked':''}><span><b>Estoy disponible para recibir solicitudes</b><small>Desactívalo cuando no puedas aceptar nuevos trabajos.</small></span></label>
 <button class="professional-quote" type="submit">Guardar perfil profesional</button></form>
 <p class="professional-field-note">En esta versión puedes publicar tu perfil sin suscripción. Los planes se incorporarán en una etapa posterior.</p></section>`,true);
}
async function saveProfessionalProfile(e){
 e.preventDefault();const form=e.target;if(state.professionalSaving||!form.reportValidity())return;const uid=state.user?.id;if(!uid)return;
 const f=new FormData(form),button=form.querySelector('button[type="submit"]'),note=document.getElementById('professionalProfileFeedback');state.professionalSaving=true;button.disabled=true;button.textContent='Guardando…';note.hidden=true;
 const row={user_id:uid,profession_id:String(f.get('profession_id')),headline:String(f.get('headline')||'').trim(),about:String(f.get('about')||'').trim(),city:String(f.get('city')||'').trim(),service_area:String(f.get('service_area')||'').trim(),years_experience:f.get('years_experience')===''?null:Number(f.get('years_experience')),license_number:String(f.get('license_number')||'').trim(),is_published:f.get('is_published')==='on',accepting_requests:f.get('accepting_requests')==='on'};
 try{if(!professionById(row.profession_id))throw Error('Elige una profesión válida.');const {error}=await sb.from('professional_profiles').upsert(row,{onConflict:'user_id'});if(error)throw error;if(state.user?.id!==uid)return;state.ownProfessionalProfile=row;if(note.isConnected){note.hidden=false;note.setAttribute('role','status');note.textContent=row.is_published?(row.accepting_requests?'Perfil publicado. Puedes recibir solicitudes.':'Perfil guardado y publicado, sin disponibilidad para nuevas solicitudes.'):'Perfil guardado. Está oculto en el catálogo.'}}
 catch(err){if(note.isConnected){note.hidden=false;note.setAttribute('role','alert');note.textContent='No pudimos guardar tu perfil. '+friendlyError(err.message||err)}}
 finally{state.professionalSaving=false;if(button.isConnected){button.disabled=false;button.textContent='Guardar perfil profesional'}}
}
function clearProfessionalSession(){state.professionRequest=null;state.viewedProfessional=null;state.ownProfessionalProfile=null;state.professionalList=[];state.professionCounts={};state.professionLoadToken=(state.professionLoadToken||0)+1;state.professionalSaving=false}
