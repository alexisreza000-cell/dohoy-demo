-- DOHOY 5.8: opt-in, permanent professional profiles and atomic quote invitations.
-- A future subscription can gate directory publication without replacing these profiles.
create table public.profession_catalog (
 id text primary key,
 title text not null,
 task_category text not null,
 is_active boolean not null default true
);
insert into public.profession_catalog(id,title,task_category) values
 ('medicine','Medicina','Medicina'),('nursing','Enfermería','Enfermería'),
 ('veterinary','Veterinaria','Veterinaria'),('architecture','Arquitectura','Arquitectura'),
 ('engineering','Ingeniería civil','Ingeniería civil'),('masonry','Albañilería','Albañilería'),
 ('plumbing','Plomería','Plomería'),('electrical','Electricidad','Electricidad'),
 ('painting','Pintura','Pintura'),('carpentry','Carpintería','Carpintería'),
 ('cleaning','Limpieza','Limpieza'),('gardening','Jardinería','Jardinería'),
 ('air_conditioning','Climatización','Climatización'),('technology','Tecnología','Tecnología'),
 ('accounting','Contabilidad','Contabilidad'),('legal','Asesoría legal','Asesoría legal');
alter table public.profession_catalog enable row level security;
revoke all on public.profession_catalog from anon,authenticated;
grant select on public.profession_catalog to authenticated;
grant all on public.profession_catalog to service_role;
create policy profession_catalog_read on public.profession_catalog for select to authenticated using (is_active);

create table public.professional_profiles (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 profession_id text not null references public.profession_catalog(id),
 headline text not null check(length(trim(headline)) between 3 and 100),
 about text not null check(length(trim(about)) between 10 and 1500),
 city text not null check(length(trim(city)) between 2 and 80),
 service_area text not null default '' check(length(service_area)<=160),
 years_experience integer check(years_experience between 0 and 80),
 license_number text not null default '' check(length(license_number)<=30),
 accepting_requests boolean not null default true,
 is_published boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.professional_profiles enable row level security;
revoke all on public.professional_profiles from anon,authenticated;
grant select,insert,update on public.professional_profiles to authenticated;
grant all on public.professional_profiles to service_role;
create policy professional_owner_read on public.professional_profiles for select to authenticated
 using ((select auth.uid())=user_id);
create policy professional_owner_insert on public.professional_profiles for insert to authenticated
 with check ((select auth.uid())=user_id and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and not coalesce(p.is_suspended,false)));
create policy professional_owner_update on public.professional_profiles for update to authenticated
 using ((select auth.uid())=user_id)
 with check ((select auth.uid())=user_id and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and not coalesce(p.is_suspended,false)));
create index professional_directory_published_idx on public.professional_profiles(profession_id,updated_at desc,user_id) where is_published;

create function private.guard_professional_profile() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 new.headline:=trim(new.headline);new.about:=trim(new.about);new.city:=trim(new.city);
 new.service_area:=trim(new.service_area);new.license_number:=trim(new.license_number);
 new.updated_at:=now();
 if tg_op='UPDATE' then new.created_at:=old.created_at;else new.created_at:=now();end if;
 return new;
end $$;
revoke all on function private.guard_professional_profile() from public,anon,authenticated;
create trigger guard_professional_profile before insert or update on public.professional_profiles for each row execute function private.guard_professional_profile();

-- Only this safe projection is readable by other users. No phone, address or payment IDs.
create function private.rpc_professional_directory(p_profession_id text,p_city text,p_available_only boolean,p_limit integer,p_offset integer,p_user_id uuid)
returns table(user_id uuid,profession_id text,full_name text,last_name text,avatar_url text,
 headline text,about text,city text,service_area text,years_experience integer,license_number text,
 accepting_requests boolean,rating numeric,completed_tasks integer,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null or not exists(select 1 from public.profiles p where p.id=v_uid and not coalesce(p.is_suspended,false)) then raise exception 'Cuenta no disponible' using errcode='42501';end if;
 return query select d.user_id,d.profession_id,p.full_name,p.last_name,p.avatar_url,
 d.headline,d.about,d.city,d.service_area,d.years_experience,d.license_number,
 d.accepting_requests,coalesce(p.rating,0),coalesce(p.completed_tasks,0),p.created_at
 from public.professional_profiles d join public.profiles p on p.id=d.user_id
 join public.profession_catalog c on c.id=d.profession_id
 where c.is_active and not coalesce(p.is_suspended,false)
 and (d.is_published or (p_user_id=v_uid and d.user_id=v_uid))
 and (d.user_id<>v_uid or p_user_id=v_uid)
 and (p_user_id is null or d.user_id=p_user_id)
 and (p_profession_id is null or d.profession_id=p_profession_id)
 and (not coalesce(p_available_only,true) or d.accepting_requests)
 and (nullif(trim(p_city),'') is null or strpos(translate(lower(d.city||' '||d.service_area),'áéíóúüñ','aeiouun'),translate(lower(trim(p_city)),'áéíóúüñ','aeiouun'))>0)
 and not exists(select 1 from public.user_blocks b where (b.blocker_id=v_uid and b.blocked_id=d.user_id) or (b.blocker_id=d.user_id and b.blocked_id=v_uid))
 order by d.accepting_requests desc,p.completed_tasks desc nulls last,p.rating desc nulls last,d.user_id
 limit least(100,greatest(1,coalesce(p_limit,24))) offset least(100000,greatest(0,coalesce(p_offset,0)));
end $$;
create function public.professional_directory(p_profession_id text default null,p_city text default null,p_available_only boolean default true,p_limit integer default 24,p_offset integer default 0,p_user_id uuid default null)
returns table(user_id uuid,profession_id text,full_name text,last_name text,avatar_url text,
 headline text,about text,city text,service_area text,years_experience integer,license_number text,
 accepting_requests boolean,rating numeric,completed_tasks integer,created_at timestamptz)
language sql stable security invoker set search_path='' as $$select * from private.rpc_professional_directory(p_profession_id,p_city,p_available_only,p_limit,p_offset,p_user_id)$$;
revoke all on function private.rpc_professional_directory(text,text,boolean,integer,integer,uuid) from public,anon;
revoke all on function public.professional_directory(text,text,boolean,integer,integer,uuid) from public,anon;
grant execute on function private.rpc_professional_directory(text,text,boolean,integer,integer,uuid) to authenticated;
grant execute on function public.professional_directory(text,text,boolean,integer,integer,uuid) to authenticated;

create function private.rpc_professional_directory_counts(p_city text)
returns table(profession_id text,available_count bigint)
language plpgsql stable security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null or not exists(select 1 from public.profiles p where p.id=v_uid and not coalesce(p.is_suspended,false)) then raise exception 'Cuenta no disponible' using errcode='42501';end if;
 return query select d.profession_id,count(*) from public.professional_profiles d
 join public.profiles p on p.id=d.user_id join public.profession_catalog c on c.id=d.profession_id
 where d.is_published and d.accepting_requests and c.is_active and d.user_id<>v_uid and not coalesce(p.is_suspended,false)
 and (nullif(trim(p_city),'') is null or strpos(translate(lower(d.city||' '||d.service_area),'áéíóúüñ','aeiouun'),translate(lower(trim(p_city)),'áéíóúüñ','aeiouun'))>0)
 and not exists(select 1 from public.user_blocks b where (b.blocker_id=v_uid and b.blocked_id=d.user_id) or (b.blocker_id=d.user_id and b.blocked_id=v_uid))
 group by d.profession_id;
end $$;
create function public.professional_directory_counts(p_city text default null)
returns table(profession_id text,available_count bigint) language sql stable security invoker set search_path='' as $$select * from private.rpc_professional_directory_counts(p_city)$$;
revoke all on function private.rpc_professional_directory_counts(text) from public,anon;
revoke all on function public.professional_directory_counts(text) from public,anon;
grant execute on function private.rpc_professional_directory_counts(text) to authenticated;
grant execute on function public.professional_directory_counts(text) to authenticated;

-- Open-task tables hide private data; invitations get their own safe projection.
create function private.rpc_worker_pending_invitations()
returns table(id uuid,task_id uuid,client_id uuid,status text,message text,proposed_amount numeric,created_at timestamptz,tasks jsonb)
language plpgsql stable security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null or not exists(select 1 from public.profiles p where p.id=v_uid and not coalesce(p.is_suspended,false)) then raise exception 'Cuenta no disponible' using errcode='42501';end if;
 return query select i.id,i.task_id,i.client_id,i.status,i.message,i.proposed_amount,i.created_at,
 jsonb_build_object('title',t.title,'category',t.category,'offered_price',t.offered_price,'scheduled_for',t.scheduled_for,'service_kind',t.service_kind)
 from public.task_invitations i join public.tasks t on t.id=i.task_id join public.profiles p on p.id=i.client_id
 where i.worker_id=v_uid and i.status='pending' and t.status='open' and t.worker_id is null and not coalesce(p.is_suspended,false)
 and not exists(select 1 from public.user_blocks b where (b.blocker_id=v_uid and b.blocked_id=i.client_id) or (b.blocker_id=i.client_id and b.blocked_id=v_uid))
 order by i.created_at desc,i.id limit 20;
end $$;
create function public.worker_pending_invitations()
returns table(id uuid,task_id uuid,client_id uuid,status text,message text,proposed_amount numeric,created_at timestamptz,tasks jsonb)
language sql stable security invoker set search_path='' as $$select * from private.rpc_worker_pending_invitations()$$;
revoke all on function private.rpc_worker_pending_invitations() from public,anon;
revoke all on function public.worker_pending_invitations() from public,anon;
grant execute on function private.rpc_worker_pending_invitations() to authenticated;
grant execute on function public.worker_pending_invitations() to authenticated;

create function private.rpc_create_professional_quote_request(p_professional_id uuid,p_title text,p_description text,p_category text,p_offered_price numeric,p_location_label text,p_latitude double precision,p_longitude double precision,p_scheduled_for timestamptz,p_requires_driver_license boolean,p_tracking_requested boolean,p_service_kind text,p_recurrence_frequency text,p_recurrence_parent_id uuid)
returns public.tasks language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid();v_task public.tasks%rowtype;v_professional public.professional_profiles%rowtype;v_category text;
begin
 if v_uid is null or p_professional_id is null or v_uid=p_professional_id then raise exception 'Elige un profesional disponible' using errcode='42501';end if;
 if p_service_kind is distinct from 'project' or p_recurrence_frequency is not null or p_recurrence_parent_id is not null then raise exception 'La solicitud directa debe ser un proyecto';end if;
 select d.* into v_professional from public.professional_profiles d join public.profiles p on p.id=d.user_id
 where d.user_id=p_professional_id and d.is_published and d.accepting_requests and not coalesce(p.is_suspended,false) for share of d;
 if v_professional.user_id is null or exists(select 1 from public.user_blocks b where (b.blocker_id=v_uid and b.blocked_id=p_professional_id) or (b.blocker_id=p_professional_id and b.blocked_id=v_uid)) then raise exception 'Este profesional no recibe solicitudes por ahora' using errcode='42501';end if;
 select c.task_category into v_category from public.profession_catalog c where c.id=v_professional.profession_id and c.is_active;
 if v_category is null or p_category is distinct from v_category then raise exception 'La profesión de esta solicitud cambió. Vuelve a elegir un profesional';end if;
 v_task:=private.rpc_create_service_task(p_title,p_description,p_category,p_offered_price,p_location_label,p_latitude,p_longitude,p_scheduled_for,p_requires_driver_license,p_tracking_requested,'project',null,null);
 insert into public.task_invitations(task_id,client_id,worker_id,status,proposed_amount,message)
 values(v_task.id,v_uid,p_professional_id,'pending',null,'Me gustaría recibir tu cotización para este servicio.');
 perform public.notify_user(p_professional_id,'task','Solicitud de cotización',p_title,v_task.id);
 return v_task;
end $$;
create function public.create_professional_quote_request(p_professional_id uuid,p_title text,p_description text,p_category text,p_offered_price numeric,p_location_label text,p_latitude double precision,p_longitude double precision,p_scheduled_for timestamptz,p_requires_driver_license boolean,p_tracking_requested boolean,p_service_kind text,p_recurrence_frequency text,p_recurrence_parent_id uuid default null)
returns public.tasks language sql security invoker set search_path='' as $$select private.rpc_create_professional_quote_request(p_professional_id,p_title,p_description,p_category,p_offered_price,p_location_label,p_latitude,p_longitude,p_scheduled_for,p_requires_driver_license,p_tracking_requested,p_service_kind,p_recurrence_frequency,p_recurrence_parent_id)$$;
revoke all on function private.rpc_create_professional_quote_request(uuid,text,text,text,numeric,text,double precision,double precision,timestamptz,boolean,boolean,text,text,uuid) from public,anon;
revoke all on function public.create_professional_quote_request(uuid,text,text,text,numeric,text,double precision,double precision,timestamptz,boolean,boolean,text,text,uuid) from public,anon;
grant execute on function private.rpc_create_professional_quote_request(uuid,text,text,text,numeric,text,double precision,double precision,timestamptz,boolean,boolean,text,text,uuid) to authenticated;
grant execute on function public.create_professional_quote_request(uuid,text,text,text,numeric,text,double precision,double precision,timestamptz,boolean,boolean,text,text,uuid) to authenticated;

-- Submitting a complete quote closes its pending invitation in the same transaction.
create function private.close_invitation_on_quote() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is distinct from new.worker_id then return new;end if;
 if new.status in ('pending','accepted') then
  update public.task_invitations set status='accepted',updated_at=now()
  where task_id=new.task_id and worker_id=new.worker_id and status='pending';
 end if;
 return new;
end $$;
revoke all on function private.close_invitation_on_quote() from public,anon,authenticated;
create trigger close_invitation_on_quote after insert or update on public.task_offers for each row execute function private.close_invitation_on_quote();
