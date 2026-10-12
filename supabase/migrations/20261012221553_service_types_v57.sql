-- DOHOY 5.7: additive service metadata; existing tasks retain their prices.
alter table public.tasks
  add column service_kind text not null default 'daily',
  add column recurrence_frequency text,
  add column recurrence_parent_id uuid references public.tasks(id) on delete set null,
  add column pricing_rule_version smallint not null default 0;
alter table public.tasks alter column pricing_rule_version set default 1;
alter table public.tasks add constraint tasks_service_kind_check check (service_kind in ('daily','project','recurring')),
  add constraint tasks_recurrence_check check ((service_kind='recurring' and recurrence_frequency in ('daily','weekly','biweekly','monthly') and recurrence_frequency is not null) or (service_kind<>'recurring' and recurrence_frequency is null and recurrence_parent_id is null)),
  add constraint tasks_service_price_check check (offered_price not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) and (service_kind='project' or offered_price>0) and (service_kind<>'daily' or pricing_rule_version=0 or offered_price>=100)),
  add constraint tasks_pricing_version_check check (pricing_rule_version in (0,1));

alter table public.task_offers add column quote_scope text,add column quote_materials text,add column quote_timeline text,add column quote_stages text;
alter table public.worker_preferences add column service_kinds text[] not null default array['daily','project','recurring'],add column service_kind text not null default '';
alter table public.worker_preferences add constraint worker_service_kinds_check check (cardinality(service_kinds)>0 and service_kinds <@ array['daily','project','recurring']::text[] and array_position(service_kinds,null) is null),
  add constraint worker_service_kind_check check (service_kind='' or service_kind=any(service_kinds));

create function private.guard_service_task() returns trigger language plpgsql security invoker set search_path='' as $$
declare v_parent public.tasks%rowtype;
begin
  if tg_op='INSERT' then new.pricing_rule_version:=1;
  elsif new.service_kind is distinct from old.service_kind or new.recurrence_frequency is distinct from old.recurrence_frequency or (new.recurrence_parent_id is not null and new.recurrence_parent_id is distinct from old.recurrence_parent_id) or new.pricing_rule_version is distinct from old.pricing_rule_version then
    if auth.uid() is not null and (auth.uid() is distinct from old.client_id or old.status<>'open' or old.worker_id is not null) then raise exception 'Solo el cliente puede cambiar un servicio abierto' using errcode='42501';end if;
    if new.pricing_rule_version<old.pricing_rule_version then raise exception 'No puedes quitar la regla de precio mínimo';end if;
  end if;
  if new.service_kind is null or new.service_kind not in ('daily','project','recurring') then raise exception 'Elige un tipo de servicio válido';end if;
  if new.offered_price is null or new.offered_price in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) or new.offered_price<0 then raise exception 'Indica un precio válido';end if;
  if new.service_kind='daily' and new.pricing_rule_version=1 and new.offered_price<100 then raise exception 'El mínimo para tareas diarias es $100 por el servicio';end if;
  if new.service_kind='recurring' then
    if new.offered_price<=0 then raise exception 'Indica un precio por visita mayor a cero';end if;
    if new.recurrence_frequency is null or new.recurrence_frequency not in ('daily','weekly','biweekly','monthly') then raise exception 'Elige una frecuencia válida';end if;
  elsif new.recurrence_frequency is not null or new.recurrence_parent_id is not null then raise exception 'La frecuencia solo corresponde a servicios recurrentes';end if;
  if new.recurrence_parent_id is not null and (tg_op='INSERT' or new.recurrence_parent_id is distinct from old.recurrence_parent_id) then
    select * into v_parent from public.tasks where id=new.recurrence_parent_id;
    if v_parent.id is null or v_parent.client_id is distinct from new.client_id or v_parent.service_kind<>'recurring' or v_parent.status<>'completed' then raise exception 'No se puede usar ese servicio para agendar otra visita' using errcode='42501';end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_service_task() from public,anon,authenticated;
create trigger guard_service_task before insert or update on public.tasks for each row execute function private.guard_service_task();

create function private.guard_service_offer() returns trigger language plpgsql security invoker set search_path='' as $$
declare v_task public.tasks%rowtype;
begin
 select * into v_task from public.tasks where id=new.task_id;
 if v_task.id is null then raise exception 'Tarea no disponible';end if;
 if new.amount is null or new.amount<=0 or new.amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) then raise exception 'Indica un monto mayor a cero';end if;
 if new.counter_amount is not null and (new.counter_amount<=0 or new.counter_amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)) then raise exception 'Contraoferta inválida';end if;
 if v_task.service_kind='daily' and v_task.pricing_rule_version=1 and (new.amount<100 or (new.counter_amount is not null and new.counter_amount<100)) then raise exception 'El mínimo para tareas diarias es $100 por el servicio';end if;
 if v_task.service_kind in ('project','recurring') and (length(trim(coalesce(new.quote_scope,'')))<10 or length(trim(coalesce(new.quote_materials,'')))<3 or length(trim(coalesce(new.quote_timeline,'')))<2) then raise exception 'Completa el alcance, materiales y tiempo estimado de la cotización';end if;
 if length(coalesce(new.quote_scope,''))>1500 or length(coalesce(new.quote_materials,''))>1000 or length(coalesce(new.quote_timeline,''))>200 or length(coalesce(new.quote_stages,''))>1500 then raise exception 'La cotización supera el límite de texto';end if;
 if tg_op='UPDATE' and v_task.pricing_rule_version=1 then
   if v_task.status<>'open' and (new.amount is distinct from old.amount or new.counter_amount is distinct from old.counter_amount or new.quote_scope is distinct from old.quote_scope or new.quote_materials is distinct from old.quote_materials or new.quote_timeline is distinct from old.quote_timeline or new.quote_stages is distinct from old.quote_stages) then raise exception 'El precio y alcance acordados no pueden modificarse';end if;
   if new.amount is distinct from old.amount and auth.uid() is not null and auth.uid() is distinct from old.worker_id then raise exception 'Para negociar el precio envía una contraoferta' using errcode='42501';end if;
   if new.counter_amount is not null and new.counter_amount is distinct from old.counter_amount and auth.uid() is not null and auth.uid() is distinct from v_task.client_id then raise exception 'Solo el cliente puede proponer una contraoferta' using errcode='42501';end if;
 end if;
 if tg_op='UPDATE' and (new.quote_scope is distinct from old.quote_scope or new.quote_materials is distinct from old.quote_materials or new.quote_timeline is distinct from old.quote_timeline or new.quote_stages is distinct from old.quote_stages) and auth.uid() is not null then
   if auth.uid() is distinct from old.worker_id or v_task.status<>'open' then raise exception 'La cotización acordada no puede modificarse' using errcode='42501';end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_service_offer() from public,anon,authenticated;
create trigger guard_service_offer before insert or update on public.task_offers for each row execute function private.guard_service_offer();

create function private.rpc_create_service_task(p_title text,p_description text,p_category text,p_offered_price numeric,p_location_label text,p_latitude double precision,p_longitude double precision,p_scheduled_for timestamptz,p_requires_driver_license boolean,p_tracking_requested boolean,p_service_kind text,p_recurrence_frequency text,p_recurrence_parent_id uuid)
returns public.tasks language plpgsql security definer set search_path='' as $$
declare v_task public.tasks%rowtype;v_uid uuid:=auth.uid();
begin
 if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and not coalesce(is_suspended,false)) then raise exception 'Cuenta no disponible' using errcode='42501';end if;
 if length(trim(coalesce(p_title,''))) not between 3 and 120 then raise exception 'Agrega un título válido';end if;
 if length(trim(coalesce(p_description,''))) not between 1 and 4000 then raise exception 'Describe el servicio';end if;
 if length(trim(coalesce(p_category,''))) not between 1 and 100 then raise exception 'Elige una categoría';end if;
 if length(trim(coalesce(p_location_label,''))) not between 1 and 160 then raise exception 'Indica la zona del servicio';end if;
 if (p_latitude is null)<>(p_longitude is null) or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'Ubicación inválida';end if;
 insert into public.tasks(client_id,title,description,category,offered_price,location_label,latitude,longitude,scheduled_for,requires_driver_license,tracking_requested,service_kind,recurrence_frequency,recurrence_parent_id,status)
 values(v_uid,trim(p_title),trim(p_description),trim(p_category),p_offered_price,'Zona aproximada',round(p_latitude::numeric,2)::double precision,round(p_longitude::numeric,2)::double precision,p_scheduled_for,coalesce(p_requires_driver_license,false),coalesce(p_tracking_requested,false),p_service_kind,p_recurrence_frequency,p_recurrence_parent_id,'open') returning * into v_task;
 insert into public.task_private_locations(task_id,client_id,location_label,latitude,longitude) values(v_task.id,v_uid,trim(p_location_label),p_latitude,p_longitude);
 return v_task;
end $$;
create function public.create_service_task(p_title text,p_description text,p_category text,p_offered_price numeric,p_location_label text,p_latitude double precision,p_longitude double precision,p_scheduled_for timestamptz,p_requires_driver_license boolean,p_tracking_requested boolean,p_service_kind text,p_recurrence_frequency text,p_recurrence_parent_id uuid default null)
returns public.tasks language sql security invoker set search_path='' as $$select private.rpc_create_service_task(p_title,p_description,p_category,p_offered_price,p_location_label,p_latitude,p_longitude,p_scheduled_for,p_requires_driver_license,p_tracking_requested,p_service_kind,p_recurrence_frequency,p_recurrence_parent_id)$$;
revoke all on function private.rpc_create_service_task(text,text,text,numeric,text,double precision,double precision,timestamptz,boolean,boolean,text,text,uuid) from public,anon;
revoke all on function public.create_service_task(text,text,text,numeric,text,double precision,double precision,timestamptz,boolean,boolean,text,text,uuid) from public,anon;
grant execute on function private.rpc_create_service_task(text,text,text,numeric,text,double precision,double precision,timestamptz,boolean,boolean,text,text,uuid),public.create_service_task(text,text,text,numeric,text,double precision,double precision,timestamptz,boolean,boolean,text,text,uuid) to authenticated;

create function private.rpc_edit_service_task(p_task_id uuid,p_title text,p_description text,p_category text,p_offered_price numeric,p_location_label text,p_latitude double precision,p_longitude double precision,p_scheduled_for timestamptz,p_requires_driver_license boolean,p_recurrence_frequency text)
returns public.tasks language plpgsql security definer set search_path='' as $$
declare v_task public.tasks%rowtype;v_uid uuid:=auth.uid();
begin
 if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and not coalesce(is_suspended,false)) then raise exception 'Cuenta no disponible' using errcode='42501';end if;
 select * into v_task from public.tasks where id=p_task_id for update;
 if v_task.id is null or v_task.client_id is distinct from v_uid then raise exception 'No autorizado' using errcode='42501';end if;
 if v_task.status<>'open' or v_task.worker_id is not null then raise exception 'Solo puedes editar un servicio abierto';end if;
 if length(trim(coalesce(p_title,''))) not between 3 and 120 or length(trim(coalesce(p_description,''))) not between 1 and 4000 then raise exception 'Revisa el título y la descripción';end if;
 if length(trim(coalesce(p_category,''))) not between 1 and 100 or length(trim(coalesce(p_location_label,''))) not between 1 and 160 then raise exception 'Revisa la categoría y la ubicación';end if;
 if (p_latitude is null)<>(p_longitude is null) or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then raise exception 'Ubicación inválida';end if;
 update public.tasks set title=trim(p_title),description=trim(p_description),category=trim(p_category),offered_price=p_offered_price,location_label='Zona aproximada',latitude=round(p_latitude::numeric,2)::double precision,longitude=round(p_longitude::numeric,2)::double precision,scheduled_for=p_scheduled_for,requires_driver_license=coalesce(p_requires_driver_license,false),recurrence_frequency=p_recurrence_frequency,updated_at=now() where id=p_task_id returning * into v_task;
 insert into public.task_private_locations(task_id,client_id,location_label,latitude,longitude,updated_at) values(p_task_id,v_uid,trim(p_location_label),p_latitude,p_longitude,now()) on conflict(task_id) do update set location_label=excluded.location_label,latitude=excluded.latitude,longitude=excluded.longitude,updated_at=now();
 return v_task;
end $$;
create function public.edit_service_task(p_task_id uuid,p_title text,p_description text,p_category text,p_offered_price numeric,p_location_label text,p_latitude double precision,p_longitude double precision,p_scheduled_for timestamptz,p_requires_driver_license boolean,p_recurrence_frequency text)
returns public.tasks language sql security invoker set search_path='' as $$select private.rpc_edit_service_task(p_task_id,p_title,p_description,p_category,p_offered_price,p_location_label,p_latitude,p_longitude,p_scheduled_for,p_requires_driver_license,p_recurrence_frequency)$$;
revoke all on function private.rpc_edit_service_task(uuid,text,text,text,numeric,text,double precision,double precision,timestamptz,boolean,text),public.edit_service_task(uuid,text,text,text,numeric,text,double precision,double precision,timestamptz,boolean,text) from public,anon;
grant execute on function private.rpc_edit_service_task(uuid,text,text,text,numeric,text,double precision,double precision,timestamptz,boolean,text),public.edit_service_task(uuid,text,text,text,numeric,text,double precision,double precision,timestamptz,boolean,text) to authenticated;

create function private.rpc_submit_service_quote(p_task_id uuid,p_amount numeric,p_message text,p_quote_scope text,p_quote_materials text,p_quote_timeline text,p_quote_stages text)
returns public.task_offers language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();v_task public.tasks%rowtype;v_offer public.task_offers%rowtype;
begin
 if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and not coalesce(is_suspended,false)) then raise exception 'Cuenta no disponible' using errcode='42501';end if;
 select * into v_task from public.tasks where id=p_task_id for update;
 if v_task.id is null or v_task.status<>'open' or v_task.worker_id is not null then raise exception 'El servicio ya no está disponible';end if;
 if v_task.client_id=v_uid or private.users_are_blocked(v_task.client_id,v_uid) then raise exception 'No puedes enviar una propuesta a este servicio' using errcode='42501';end if;
 if length(coalesce(p_message,''))>1000 then raise exception 'El mensaje es demasiado largo';end if;
 insert into public.task_offers(task_id,worker_id,amount,message,quote_scope,quote_materials,quote_timeline,quote_stages)
 values(p_task_id,v_uid,p_amount,nullif(trim(p_message),''),case when v_task.service_kind='daily' then null else nullif(trim(p_quote_scope),'') end,case when v_task.service_kind='daily' then null else nullif(trim(p_quote_materials),'') end,case when v_task.service_kind='daily' then null else nullif(trim(p_quote_timeline),'') end,case when v_task.service_kind='project' then nullif(trim(p_quote_stages),'') else null end)
 on conflict(task_id,worker_id) do update set amount=excluded.amount,message=excluded.message,quote_scope=excluded.quote_scope,quote_materials=excluded.quote_materials,quote_timeline=excluded.quote_timeline,quote_stages=excluded.quote_stages,status='pending',counter_amount=null,counter_message=null,counter_status=null,countered_at=null returning * into v_offer;
 return v_offer;
end $$;
create function public.submit_service_quote(p_task_id uuid,p_amount numeric,p_message text default null,p_quote_scope text default null,p_quote_materials text default null,p_quote_timeline text default null,p_quote_stages text default null)
returns public.task_offers language sql security invoker set search_path='' as $$select private.rpc_submit_service_quote(p_task_id,p_amount,p_message,p_quote_scope,p_quote_materials,p_quote_timeline,p_quote_stages)$$;
revoke all on function private.rpc_submit_service_quote(uuid,numeric,text,text,text,text,text),public.submit_service_quote(uuid,numeric,text,text,text,text,text) from public,anon;
grant execute on function private.rpc_submit_service_quote(uuid,numeric,text,text,text,text,text),public.submit_service_quote(uuid,numeric,text,text,text,text,text) to authenticated;

-- Use the complete composite row, then sanitize private fields. This also fixes
-- the old column-list mismatch caused by tracking_requested being added earlier.
create or replace function private.rpc_browse_open_tasks() returns setof public.tasks language plpgsql stable security definer set search_path='' as $$
declare v_task public.tasks%rowtype;
begin
 if auth.uid() is null then raise exception 'No autorizado' using errcode='42501';end if;
 for v_task in select t.* from public.tasks t where t.status='open' and t.client_id<>auth.uid() and not private.users_are_blocked(t.client_id,auth.uid()) order by t.created_at desc loop
  v_task.location_label:='Ubicación aproximada';v_task.latitude:=round(v_task.latitude::numeric,2)::double precision;v_task.longitude:=round(v_task.longitude::numeric,2)::double precision;
  v_task.cancellation_reason:=null;v_task.cancelled_by:=null;v_task.cancelled_at:=null;v_task.recurrence_parent_id:=null;
  return next v_task;
 end loop;
end $$;
create or replace function private.rpc_get_open_task_preview(p_task_id uuid) returns public.tasks language plpgsql stable security definer set search_path='' as $$
declare v_task public.tasks%rowtype;
begin
 if auth.uid() is null then raise exception 'No autorizado' using errcode='42501';end if;
 select t.* into v_task from public.tasks t where t.id=p_task_id and t.status='open' and t.client_id<>auth.uid() and not private.users_are_blocked(t.client_id,auth.uid());
 if v_task.id is null then raise exception 'Tarea no disponible';end if;
 v_task.location_label:='Ubicación aproximada';v_task.latitude:=round(v_task.latitude::numeric,2)::double precision;v_task.longitude:=round(v_task.longitude::numeric,2)::double precision;
 v_task.cancellation_reason:=null;v_task.cancelled_by:=null;v_task.cancelled_at:=null;v_task.recurrence_parent_id:=null;return v_task;
end $$;

create function private.rpc_worker_activity_services() returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'No autorizado' using errcode='42501';end if;
 return query select to_jsonb(x)||jsonb_build_object('service_kind',t.service_kind,'recurrence_frequency',t.recurrence_frequency,'pricing_rule_version',t.pricing_rule_version) from public.worker_activity() x join public.tasks t on t.id=x.task_id;
end $$;
create function public.worker_activity_services() returns setof jsonb language sql stable security invoker set search_path='' as $$select * from private.rpc_worker_activity_services()$$;
revoke all on function private.rpc_worker_activity_services(),public.worker_activity_services() from public,anon;
grant execute on function private.rpc_worker_activity_services(),public.worker_activity_services() to authenticated;

CREATE OR REPLACE FUNCTION public.notify_matching_workers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pref record;
begin
 if new.status<>'open' then return new; end if;
 for pref in select wp.user_id from public.worker_preferences wp join public.profiles p on p.id=wp.user_id where wp.notify_matching and not coalesce(p.is_suspended,false) and wp.user_id<>new.client_id and not private.users_are_blocked(wp.user_id,new.client_id)
 and new.service_kind=any(wp.service_kinds) and (wp.service_kind='' or wp.service_kind=new.service_kind)
 and ((new.service_kind='project' and new.offered_price=0) or new.offered_price>=coalesce(wp.min_price,0))
 and (coalesce(array_length(wp.categories,1),0)=0 or split_part(new.category,'|',1)=any(wp.categories))
 and (not wp.requires_license_only or new.requires_driver_license or split_part(new.category,'|',1)='Vehículo')
 and (wp.search_text='' or new.title ilike '%'||wp.search_text||'%' or new.description ilike '%'||wp.search_text||'%')
 and (not wp.today_only or (coalesce(new.scheduled_for,new.created_at) at time zone 'America/Monterrey')::date=(now() at time zone 'America/Monterrey')::date)
 and (wp.max_distance_km is null or (new.latitude is not null and new.longitude is not null and wp.origin_latitude is not null and wp.origin_longitude is not null and 6371*2*asin(sqrt(least(1.0,power(sin(radians(new.latitude-wp.origin_latitude)/2),2)+cos(radians(wp.origin_latitude))*cos(radians(new.latitude))*power(sin(radians(new.longitude-wp.origin_longitude)/2),2))))<=wp.max_distance_km))
 loop perform public.notify_user(pref.user_id,'matching_task','Nueva tarea para ti',new.title,new.id); end loop;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.notify_saved_searches()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pref record; distance_km double precision;
begin
 if new.status<>'open' then return new; end if;
 for pref in select s.* from public.saved_searches s join public.profiles p on p.id=s.user_id where s.notify_matching and not coalesce(p.is_suspended,false) and s.user_id<>new.client_id and not private.users_are_blocked(s.user_id,new.client_id) loop
  if not exists(select 1 from public.worker_preferences wp where wp.user_id=pref.user_id and new.service_kind=any(wp.service_kinds)) and exists(select 1 from public.worker_preferences wp where wp.user_id=pref.user_id) then continue; end if;
  if not(new.service_kind='project' and new.offered_price=0) and new.offered_price<pref.min_price then continue; end if;
  if pref.category<>'' and split_part(new.category,'|',1)<>pref.category then continue; end if;
  if pref.vehicle_only and not(new.requires_driver_license or split_part(new.category,'|',1)='Vehículo') then continue; end if;
  if pref.query<>'' and position(lower(pref.query) in lower(new.title||' '||coalesce(new.description,'')))=0 then continue; end if;
  if pref.today_only and new.scheduled_for is not null and (new.scheduled_for at time zone 'America/Monterrey')::date<>(now() at time zone 'America/Monterrey')::date then continue; end if;
  if pref.max_distance_km is not null then
    if pref.latitude is null or pref.longitude is null or new.latitude is null or new.longitude is null then continue; end if;
    distance_km:=6371*2*asin(least(1,sqrt(power(sin(radians(new.latitude-pref.latitude)/2),2)+cos(radians(pref.latitude))*cos(radians(new.latitude))*power(sin(radians(new.longitude-pref.longitude)/2),2))));
    if distance_km>pref.max_distance_km then continue; end if;
  end if;
  if not exists(select 1 from public.notifications where user_id=pref.user_id and task_id=new.id and type='matching_task') then perform public.notify_user(pref.user_id,'matching_task','Nueva tarea: '||pref.name,new.title,new.id); end if;
 end loop;
 return new;
end$function$
;

CREATE OR REPLACE FUNCTION private.rpc_accept_task_offer(p_offer_id uuid)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_offer public.task_offers%rowtype;
  v_task public.tasks%rowtype;
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and not coalesce(is_suspended,false)) then raise exception 'Cuenta no disponible' using errcode='42501'; end if;
  select * into v_offer from public.task_offers where id=p_offer_id;
  if v_offer.id is null then raise exception 'Oferta no encontrada'; end if;
  select * into v_task from public.tasks where id=v_offer.task_id for update;
  if v_task.client_id is distinct from auth.uid() then raise exception 'No autorizado'; end if;
  if v_offer.status <> 'pending' then raise exception 'La oferta ya no está pendiente'; end if;
  if v_task.status <> 'open' or v_task.worker_id is not null then raise exception 'La tarea ya no está abierta'; end if;

  update public.task_offers
  set status=case when id=p_offer_id then 'accepted' else 'rejected' end
  where task_id=v_task.id and status in ('pending','accepted');

  update public.tasks
  set offered_price=v_offer.amount,worker_id=v_offer.worker_id,status='assigned',completion_requested_at=null,completed_at=null,updated_at=now()
  where id=v_task.id returning * into v_task;

  perform public.notify_user(v_task.client_id,'payment_required','Pago requerido','Completa el pago para que el trabajador pueda comenzar: '||v_task.title,v_task.id);
  perform public.notify_user(v_task.worker_id,'payment_pending','Esperando pago del cliente','La tarea quedó asignada. Podrás comenzar cuando el pago esté confirmado.',v_task.id);
  return v_task;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.rpc_respond_counter_offer(p_offer_id uuid, p_accept boolean)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_offer public.task_offers%rowtype; v_task public.tasks%rowtype;
begin
  if auth.uid() is null then raise exception 'No autorizado' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and not coalesce(is_suspended,false)) then raise exception 'Cuenta no disponible' using errcode='42501'; end if;
  if p_offer_id is null then raise exception 'Oferta no encontrada'; end if;
  if p_accept is null then raise exception 'Indica si aceptas la contraoferta'; end if;
  select * into v_offer from public.task_offers where id=p_offer_id for update;
  if v_offer.worker_id is distinct from (select auth.uid()) then raise exception 'No autorizado'; end if;
  select * into v_task from public.tasks where id=v_offer.task_id for update;
  if v_offer.id is null then raise exception 'Oferta no encontrada'; end if;
  if v_offer.status<>'pending' then raise exception 'La oferta ya no está pendiente'; end if;
  if v_task.status<>'open' or v_task.worker_id is not null then raise exception 'La tarea ya no está abierta'; end if;
  if v_offer.counter_status<>'pending' or v_offer.counter_amount is null then raise exception 'No hay contraoferta pendiente'; end if;
  if not p_accept then
    update public.task_offers set counter_status='declined' where id=p_offer_id;
    perform public.notify_user(v_task.client_id,'counter_declined','Contraoferta rechazada',v_task.title,v_task.id);
    return v_task;
  end if;

  update public.task_offers set amount=v_offer.counter_amount,counter_status='accepted',status='accepted' where id=p_offer_id;
  update public.task_offers set status='rejected' where task_id=v_task.id and id<>p_offer_id and status in ('pending','accepted');
  update public.tasks
  set offered_price=v_offer.counter_amount,worker_id=v_offer.worker_id,status='assigned',completion_requested_at=null,completed_at=null,updated_at=now()
  where id=v_task.id returning * into v_task;

  perform public.notify_user(v_task.client_id,'payment_required','Contraoferta aceptada · pago requerido','Completa el pago para que el trabajador pueda comenzar: '||v_task.title,v_task.id);
  perform public.notify_user(v_task.worker_id,'payment_pending','Esperando pago del cliente','Aceptaste la contraoferta. Podrás comenzar cuando el pago esté confirmado.',v_task.id);
  return v_task;
end;
$function$
;

notify pgrst,'reload schema';

