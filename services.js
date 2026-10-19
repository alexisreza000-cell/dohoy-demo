/* DOHOY 5.7 — service types share the existing account, activity and payment flow. */
const SERVICE_TYPES={
 daily:{title:'Tareas diarias',short:'Diaria',icon:'bolt',copy:'Mandados, entregas y pendientes del día.',note:'Desde $100 por el servicio',action:'Publicar tarea',categories:['Vehículo','Mandados','Paquetería','Hogar','Mascotas','Trámites','Eventos','Tecnología','Otro']},
 project:{title:'Servicios y proyectos',short:'Proyecto',icon:'briefcase',copy:'Albañilería, pintura, reparaciones y más.',note:'Recibe y compara cotizaciones',action:'Solicitar cotización',categories:['Albañilería','Pintura','Plomería','Electricidad','Carpintería','Reparaciones','Instalaciones','Otro']},
 recurring:{title:'Servicios recurrentes',short:'Recurrente',icon:'calendar',copy:'Limpieza, jardinería y mantenimiento periódico.',note:'Frecuencia y precio por visita',action:'Programar servicio',categories:['Limpieza','Jardinería','Mantenimiento','Mascotas','Otro']}
};
const SERVICE_FREQUENCIES={daily:'Diaria',weekly:'Semanal',biweekly:'Cada 15 días',monthly:'Mensual'};
function serviceKind(t){return SERVICE_TYPES[t?.service_kind]?t.service_kind:'daily'}
function publishServiceKind(){return SERVICE_TYPES[document.getElementById('taskServiceKind')?.value]?document.getElementById('taskServiceKind').value:(SERVICE_TYPES[state.publishServiceKind]?state.publishServiceKind:'daily')}
function serviceCategories(kind){return SERVICE_TYPES[kind]?.categories||SERVICE_TYPES.daily.categories}
function serviceCategoryIcon(name){return ({Albañilería:'Hogar',Pintura:'Hogar',Plomería:'tools',Electricidad:'bolt',Carpintería:'tools',Reparaciones:'tools',Instalaciones:'tools',Limpieza:'Hogar',Jardinería:'leaf',Mantenimiento:'tools'})[name]||name}
function taskMinimumPrice(t){return serviceKind(t)==='daily'&&Number(t?.pricing_rule_version??1)>0?100:10}
function taskPriceText(t){
 const kind=serviceKind(t),amount=Number(t?.offered_price||0);
 if(kind==='project'&&t?.status==='open')return amount>0?`${money(amount)} estimado`:'Por cotizar';
 return `${money(amount)}${kind==='recurring'?' / visita':''}`;
}
function serviceBadge(t){const kind=serviceKind(t);return `<span class="service-badge-v57 ${kind}">${iconSvg(SERVICE_TYPES[kind].icon)} ${SERVICE_TYPES[kind].title}${kind==='recurring'&&SERVICE_FREQUENCIES[t?.recurrence_frequency]?` · ${SERVICE_FREQUENCIES[t.recurrence_frequency]}`:''}</span>`}
function startServicePublication(kind='daily',category=''){
 state.professionRequest=null;state.publishServiceKind=SERVICE_TYPES[kind]?kind:'daily';state.publishPrefillCategory=category;state.nextVisitDraft=null;go('createTask');
}
function clientServiceSections(){return `<section class="service-sections-v57" aria-label="Elige un tipo de servicio">${Object.entries(SERVICE_TYPES).map(([kind,s])=>`<button class="service-entry-v57 ${kind}" onclick="${kind==='project'?'openProfessionCatalog()':`startServicePublication('${kind}')`}"><span class="service-entry-icon-v57">${iconSvg(s.icon)}</span><span class="service-entry-copy-v57"><b>${s.title}</b><span>${kind==='project'?'Encuentra profesionales y oficios por categoría.':s.copy}</span><small>${kind==='project'?'Ver perfiles y solicitar cotización':s.note}</small></span><span class="service-entry-arrow-v57">›</span></button>`).join('')}<p class="service-purchase-note-v57">En mandados, el precio del servicio no incluye el costo de las compras.</p></section>`}
function workerServiceSections(){
 const current=workerFilterState().serviceKind||'',allowed=state.workerServiceKinds||Object.keys(SERVICE_TYPES);
 return `<section class="worker-service-sections-v57"><div class="simple-section-head"><h2>¿Dónde quieres trabajar?</h2><button onclick="openServicePreferences()">Elegir</button></div><div class="worker-service-tabs-v57">${Object.entries(SERVICE_TYPES).map(([kind,s])=>`<button class="${current===kind?'selected':''}" aria-pressed="${current===kind}" onclick="selectWorkerService('${kind}')"><span>${iconSvg(s.icon)}</span><b>${s.title}</b><small>${allowed.includes(kind)?'Ver oportunidades':'Activar sección'}</small></button>`).join('')}</div><button class="all-services-v57 ${!current?'selected':''}" onclick="selectWorkerService('')">Ver mis secciones juntas</button></section>`;
}
function selectWorkerService(kind){
 if(kind==='project'){openProfessionCatalog();return}
 if(kind&&!(state.workerServiceKinds||Object.keys(SERVICE_TYPES)).includes(kind)){openServicePreferences();return}
 const f=workerFilterState();f.serviceKind=SERVICE_TYPES[kind]?kind:'';f.category='';state.workerCategory='';go('workerHome');
}
function openServicePreferences(){const allowed=state.workerServiceKinds||Object.keys(SERVICE_TYPES);openProfileSheet('Tus secciones','Elige dónde quieres recibir oportunidades. Puedes cambiarlo después.',`<form class="profile-inline-form" onsubmit="saveServicePreferences(event)">${Object.entries(SERVICE_TYPES).map(([kind,s])=>`<label class="service-preference-v57"><input name="service_kinds" type="checkbox" value="${kind}" ${allowed.includes(kind)?'checked':''}><span><b>${s.title}</b><small>${s.copy}</small></span></label>`).join('')}<p id="servicePreferencesNote" role="status"></p><button class="btn primary">Guardar secciones</button></form>`)}
async function saveServicePreferences(e){
 e.preventDefault();const kinds=new FormData(e.target).getAll('service_kinds').filter(k=>SERVICE_TYPES[k]);const note=document.getElementById('servicePreferencesNote'),btn=e.target.querySelector('button');
 if(!kinds.length){note.textContent='Elige al menos una sección.';return}
 if(btn.disabled)return;btn.disabled=true;
 try{const {error}=await sb.from('worker_preferences').upsert({user_id:state.user.id,service_kinds:kinds,service_kind:kinds.includes(workerFilterState().serviceKind)?workerFilterState().serviceKind:'',updated_at:new Date().toISOString()},{onConflict:'user_id'});if(error)throw error;state.workerServiceKinds=kinds;if(!kinds.includes(workerFilterState().serviceKind))workerFilterState().serviceKind='';closeProfileSheet();go('workerHome')}
 catch(err){note.textContent='No pudimos guardar tus secciones. '+friendlyError(err?.message||err);btn.disabled=false}
}
function publishServiceSelector(kind){return `<input type="hidden" name="service_kind" id="taskServiceKind" value="${kind}"><div class="publish-service-selector-v57" role="group" aria-label="Tipo de servicio">${Object.entries(SERVICE_TYPES).map(([k,s])=>`<button type="button" data-service-kind="${k}" aria-pressed="${kind===k}" class="${kind===k?'selected':''}" onclick="changePublishService('${k}')">${iconSvg(s.icon)}<span>${s.title}</span></button>`).join('')}</div>`}
function publishCategoryButtons(kind,selected){return serviceCategories(kind).map(c=>`<button type="button" class="publish-category ${c===selected?'selected':''}" onclick="selectPublishCategory(${jsArg(c)},this)">${iconSvg(c)}<span>${escapeHtml(c)}</span></button>`).join('')}
function recurringScheduleFields(frequency='weekly'){return `<div id="recurringSchedule" class="service-frequency-v57" ${publishServiceKind()==='recurring'?'':'hidden'}><label for="taskFrequency">Frecuencia del servicio</label><select id="taskFrequency" name="recurrence_frequency">${Object.entries(SERVICE_FREQUENCIES).map(([k,v])=>`<option value="${k}" ${frequency===k?'selected':''}>${v}</option>`).join('')}</select><p>La fecha y hora corresponden a la primera visita. Las siguientes se agendan y pagan por separado.</p></div>`}
function changePublishService(kind){
 if(!SERVICE_TYPES[kind])return;state.publishServiceKind=kind;document.getElementById('taskServiceKind').value=kind;
 const old=document.getElementById('taskCategoryHidden').value,cat=serviceCategories(kind).includes(old)?old:serviceCategories(kind)[0];document.getElementById('taskCategoryHidden').value=cat;
 document.querySelectorAll('[data-service-kind]').forEach(b=>{b.classList.toggle('selected',b.dataset.serviceKind===kind);b.setAttribute('aria-pressed',String(b.dataset.serviceKind===kind))});
 document.getElementById('publishCategoryGrid').innerHTML=publishCategoryButtons(kind,cat);configureServicePublication();toggleVehicleOptions(cat);loadPriceSuggestion(cat);
}
function configureServicePublication(){
 const kind=publishServiceKind(),s=SERVICE_TYPES[kind],price=document.getElementById('taskPriceInput');if(!price)return;
 price.min=kind==='daily'?'100':kind==='project'?'0':'10';price.step='0.01';price.required=kind!=='project';price.setCustomValidity('');price.placeholder=kind==='daily'?'Desde 100':kind==='project'?'Opcional':'Desde 10 por visita';
 document.getElementById('serviceBudgetTitle').textContent=kind==='project'?'Recibe cotizaciones':kind==='recurring'?'¿Cuánto ofrecerás por visita?':'¿Cuánto quieres ofrecer?';
 document.getElementById('serviceBudgetCopy').textContent=kind==='project'?'Describe el alcance y agrega fotos. Cada trabajador propondrá su precio, materiales y etapas.':kind==='recurring'?'Este monto cubre una visita. Acuerda lo que incluye y paga cada visita de forma independiente.':'El mínimo es $100 por el servicio. El costo de las compras o materiales se acuerda aparte.';
 document.getElementById('servicePriceLabel').textContent=kind==='project'?'Presupuesto estimado (opcional)':kind==='recurring'?'Precio por visita':'Precio del servicio';
 document.getElementById('recurringSchedule').hidden=kind!=='recurring';document.getElementById('taskFrequency').required=kind==='recurring';
 const button=document.getElementById('publishTaskButton');if(button)button.textContent=s.action;
 const title=document.getElementById('publishTypeTitle');if(title)title.textContent=kind==='project'?'Nuevo proyecto':kind==='recurring'?'Servicio recurrente':'Nueva tarea';
 const description=document.querySelector('#taskForm [name="description"]');if(description)description.placeholder=kind==='project'?'Qué trabajo necesitas, medidas, condiciones, materiales y etapas que tienes en mente':kind==='recurring'?'Qué debe incluir cada visita, tamaño del lugar y condiciones':'Explica qué necesitas y cualquier detalle importante';
}
function publishServiceSummary(fd){
 const kind=publishServiceKind(),price=Number(fd.get('price')||0),frequency=SERVICE_FREQUENCIES[fd.get('recurrence_frequency')]||'';
 return {type:SERVICE_TYPES[kind].title,price:kind==='project'?(price>0?`${money(price)} estimado`:'Solicitar cotizaciones'):`${money(price)}${kind==='recurring'?' por visita':''}`,frequency:kind==='recurring'?frequency:''};
}
function restoreNextVisitDraft(){
 const d=state.nextVisitDraft;if(!d)return;const form=document.getElementById('taskForm');
 for(const [name,value] of Object.entries(d))if(form.elements[name]&&value!=null)form.elements[name].value=String(value);
 form.elements.license.checked=!!d.license;form.elements.tracking_requested.checked=!!d.tracking_requested;configureServicePublication();
}
function nextServiceVisitDate(t,now=new Date()){
 let date=new Date(t.scheduled_for||now);if(!Number.isFinite(date.getTime()))date=new Date(now);
 if(t.recurrence_frequency==='monthly'){
  const day=date.getDate();date.setDate(1);date.setMonth(date.getMonth()+1);
  date.setDate(Math.min(day,new Date(date.getFullYear(),date.getMonth()+1,0).getDate()));
 }else date.setDate(date.getDate()+({daily:1,weekly:7,biweekly:15}[t.recurrence_frequency]||7));
 if(date<=now){const hours=date.getHours(),minutes=date.getMinutes();date=new Date(now);date.setDate(date.getDate()+1);date.setHours(hours,minutes,0,0)}
 return date;
}
function planNextServiceVisit(){
 const t=state.selectedTask;if(!t||serviceKind(t)!=='recurring'||t.status!=='completed'||t.client_id!==state.user?.id)return;
 state.professionRequest=null;
 const date=nextServiceVisitDate(t);
 state.publishServiceKind='recurring';state.publishPrefillCategory=baseCategory(t.category);state.nextVisitDraft={title:t.title,description:t.description,location:t.location_label,latitude:t.latitude,longitude:t.longitude,price:t.offered_price,task_date:localDateValue(date.toISOString()),task_time:localTimeValue(date.toISOString()),recurrence_frequency:t.recurrence_frequency,recurrence_parent_id:t.recurrence_parent_id||t.id,license:t.requires_driver_license,tracking_requested:t.tracking_requested};go('createTask');
}
function quoteDetailsHtml(o){if(!o||![o.quote_scope,o.quote_materials,o.quote_timeline,o.quote_stages].some(Boolean))return '';return `<dl class="quote-details-v57">${[['Alcance',o.quote_scope],['Materiales',o.quote_materials],['Tiempo estimado',o.quote_timeline],['Etapas',o.quote_stages]].filter(([,v])=>v).map(([name,value])=>`<div><dt>${name}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`}
function serviceAgreementHtml(t,offer){
 const kind=serviceKind(t);let html=`<div class="service-context-v57">${serviceBadge(t)}${kind==='project'?'<p>Compara el alcance, materiales y tiempos antes de elegir una cotización. El pago cubre el total acordado.</p>':kind==='recurring'?'<p>Cada tarea cubre una visita. La frecuencia queda guardada; las siguientes visitas se agendan y pagan por separado.</p>':'<p>El precio corresponde al servicio. Acuerda aparte el costo de las compras.</p>'}</div>`;
 if(t.worker_id&&offer&&kind!=='daily')html+=`<section class="service-agreement-v57"><h3>Lo acordado</h3><b>${money(agreedTaskAmount(t,offer))}${kind==='recurring'?' por esta visita':''}</b>${quoteDetailsHtml(offer)}</section>`;
 if(kind==='recurring'&&t.status==='completed'&&t.client_id===state.user?.id)html+=`<button class="btn primary next-visit-v57" onclick="planNextServiceVisit()">${iconSvg('calendar')} Agendar siguiente visita</button>`;return html;
}
function quoteFormFields(t){const project=serviceKind(t)!=='daily';return `<div id="offerFeedback" class="form-feedback"></div><div class="field"><label for="quoteAmount">${serviceKind(t)==='recurring'?'Tu precio por visita':'Tu precio'} (MXN)</label><input id="quoteAmount" class="input" name="amount" type="number" min="${taskMinimumPrice(t)}" step="0.01" value="${Number(t.offered_price)>0?Number(t.offered_price):''}" required></div>${project?`<div class="field"><label for="quoteScope">¿Qué incluye?</label><textarea id="quoteScope" name="quote_scope" required minlength="10" maxlength="1500" placeholder="Describe el alcance del trabajo${serviceKind(t)==='recurring'?' de cada visita':''}"></textarea></div><div class="field"><label for="quoteMaterials">Materiales y gastos</label><textarea id="quoteMaterials" name="quote_materials" required maxlength="1000" placeholder="Indica qué está incluido, quién compra y qué se paga aparte"></textarea></div><div class="field"><label for="quoteTimeline">Tiempo estimado</label><input id="quoteTimeline" name="quote_timeline" required maxlength="200" placeholder="Ej. 2 días / 3 horas por visita"></div>${serviceKind(t)==='project'?'<div class="field"><label for="quoteStages">Etapas <small>Opcional</small></label><textarea id="quoteStages" name="quote_stages" maxlength="1500" placeholder="Ej. Preparación, instalación y entrega"></textarea></div>':''}`:''}<div class="field"><label for="quoteMessage">Mensaje <small>Opcional</small></label><textarea id="quoteMessage" name="message" maxlength="1000" placeholder="Disponibilidad y detalles adicionales"></textarea></div><button class="btn primary" type="submit">${project?'Enviar cotización':'Enviar otra oferta'}</button>`}
function serviceOfferChoice(t){
 const kind=serviceKind(t);if(kind!=='daily')return `<section class="rating-card service-quote-form-v57"><h3>${kind==='project'?'Envía tu cotización':'Propón el servicio por visita'}</h3><p>${kind==='project'?'Incluye el alcance, materiales y tiempos. El cliente comparará las propuestas.':'La frecuencia ya está definida. Indica qué incluye cada visita.'}</p><form id="offerForm">${quoteFormFields(t)}</form></section>`;
 return `<div class="rating-card offer-choice-v506"><h3>¿Te funciona el precio?</h3><p>Si estás de acuerdo con ${money(t.offered_price)}, envía tu propuesta. El cliente deberá elegirte para asignarte la tarea.</p><button class="btn primary quick-accept-v506" onclick="acceptPostedPrice('${t.id}',${Number(t.offered_price)},this)">${iconSvg('verify')} Aceptar ${money(t.offered_price)}</button><div class="offer-or-v506"><span></span><b>o</b><span></span></div><details class="alternate-offer-v506"><summary>Proponer otro precio</summary><form id="offerForm">${quoteFormFields(t)}</form></details></div>`;
}
function serviceEditFields(t){return `<input type="hidden" name="service_kind" value="${serviceKind(t)}">${serviceBadge(t)}${serviceKind(t)==='recurring'?`<div class="field service-frequency-v57"><label>Frecuencia</label><select name="recurrence_frequency">${Object.entries(SERVICE_FREQUENCIES).map(([k,v])=>`<option value="${k}" ${t.recurrence_frequency===k?'selected':''}>${v}</option>`).join('')}</select><p>La fecha corresponde a esta visita.</p></div>`:''}`}
