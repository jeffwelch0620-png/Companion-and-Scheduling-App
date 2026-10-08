-- STAGED, NOT APPLIED. First shared Companion record contract.
-- Requires verified public.stores, public.people and public.store_roles from JMAX.
-- No people, auth users, restaurant grants, records or Food data are seeded here.
-- The server verifies Supabase Auth before using these SERVICE-ROLE-ONLY RPCs.
-- Keep this schema out of the Data API's exposed schema list.
begin;
create schema jmax_app;
revoke all on schema jmax_app from public, anon, authenticated, service_role;

create table jmax_app.locations (
  location_id text primary key references public.stores(id),
  timezone text not null,
  week_starts_on integer not null default 1 check (week_starts_on between 0 and 6),
  revision integer not null default 1 check (revision > 0)
);
create table jmax_app.memberships (
  id text primary key check (length(id) between 1 and 200),
  person_id uuid not null,
  location_id text not null references jmax_app.locations(location_id),
  role text not null,
  area text not null check (area in ('FOH','BOH','combined','production')),
  position text not null,
  capabilities text[] not null default '{}',
  qualifications text[] not null default '{}',
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  unique (person_id, location_id),
  foreign key (person_id,location_id,role)
    references public.store_roles(person_id,store_id,role) on delete cascade,
  check (capabilities <@ array['tasks.manage','location.manage']::text[]),
  check (not ('location.manage'=any(capabilities)) or role in ('owner','gm'))
);
create table jmax_app.records (
  id text primary key,
  location_id text not null references jmax_app.locations(location_id),
  -- Retain actor/owner identity in historical records after access is revoked.
  -- Current assignee authority is checked transactionally by the commit RPC.
  owner_id text not null,
  area text not null check (area in ('FOH','BOH','combined','production')),
  kind text not null check (kind='managerlog'),
  revision integer not null check (revision>0),
  data jsonb not null check (jsonb_typeof(data)='object'),
  updated_at timestamptz not null,
  unique (location_id,id)
);
create table jmax_app.record_history (
  location_id text not null,
  record_id text not null,
  revision integer not null,
  actor_id text not null,
  actor_name text not null,
  action text not null,
  at timestamptz not null,
  snapshot jsonb not null,
  primary key (record_id,revision),
  foreign key (location_id,record_id) references jmax_app.records(location_id,id)
);
create table jmax_app.command_receipts (
  location_id text not null references jmax_app.locations(location_id),
  actor_id text not null,
  request_id text not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  primary key (location_id,actor_id,request_id)
);
create table jmax_app.audit_events (
  id uuid primary key default gen_random_uuid(),
  location_id text not null,
  actor_id text not null,
  action text not null,
  record_id text not null,
  revision integer not null,
  at timestamptz not null
);
alter table jmax_app.locations enable row level security;
alter table jmax_app.memberships enable row level security;
alter table jmax_app.records enable row level security;
alter table jmax_app.record_history enable row level security;
alter table jmax_app.command_receipts enable row level security;
alter table jmax_app.audit_events enable row level security;
revoke all on all tables in schema jmax_app from public,anon,authenticated,service_role;

-- Provisioning changes must invalidate work read under the previous authority.
create function jmax_app.bump_membership() returns trigger language plpgsql
set search_path='' as $$ begin
  if row(new.person_id,new.location_id,new.role,new.area,new.position,new.capabilities,new.qualifications,new.active)
     is distinct from row(old.person_id,old.location_id,old.role,old.area,old.position,old.capabilities,old.qualifications,old.active)
  then new.revision:=old.revision+1; end if;
  return new;
end $$;
create trigger membership_revision before update on jmax_app.memberships
for each row execute function jmax_app.bump_membership();
create function jmax_app.bump_location() returns trigger language plpgsql
set search_path='' as $$ begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone)
  then raise sqlstate 'PT400' using message='Choose a valid restaurant timezone.'; end if;
  if tg_op='UPDATE' and row(new.timezone,new.week_starts_on) is distinct from row(old.timezone,old.week_starts_on)
  then new.revision:=old.revision+1; end if;
  return new;
end $$;
create trigger location_revision before insert or update on jmax_app.locations
for each row execute function jmax_app.bump_location();

create function jmax_app.can_manage(m jmax_app.memberships, department text) returns boolean
language sql immutable set search_path='' as $$
  select m.active and m.position <> 'Dishwasher' and
   ('location.manage'=any(m.capabilities) or ('tasks.manage'=any(m.capabilities) and m.area=department));
$$;
create function jmax_app.member_json(m jmax_app.memberships, person_name text) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',m.id,'locationId',m.location_id,'name',person_name,
  'area',m.area,'position',m.position,'capabilities',m.capabilities,'qualifications',m.qualifications);
$$;
create function jmax_app.record_json(r jmax_app.records) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'locationId',r.location_id,'ownerId',r.owner_id,
  'area',r.area,'kind',r.kind,'revision',r.revision,'data',r.data,
  'updatedAt',to_char(r.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$$;

-- Lock canonical identity, restaurant, role and mapping until this transaction ends.
-- Revoking any of them therefore cannot race a checked save.
create function jmax_app.require_member(p_auth_user_id uuid,p_location_id text)
returns jmax_app.memberships language plpgsql set search_path='' as $$
declare m jmax_app.memberships;
begin
 select mm.* into m from jmax_app.memberships mm
 join public.people p on p.id=mm.person_id
 join public.stores s on s.id=mm.location_id
 join public.store_roles sr on sr.person_id=mm.person_id and sr.store_id=mm.location_id and sr.role=mm.role
 where p.auth_user_id=p_auth_user_id and mm.location_id=p_location_id and mm.active and p.active and s.active
 for share of mm,p,s,sr;
 if not found or not jmax_app.can_manage(m,m.area) then
  raise sqlstate 'PT403' using message='No Manager Log access to this restaurant.';
 end if;
 return m;
end $$;

create function public.jmax_shared_memberships(p_auth_user_id uuid) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('memberships',coalesce(jsonb_agg(jsonb_build_object(
  'id',m.id,'locationId',m.location_id,'name',p.full_name,'position',m.position,'locationName',s.name)
  order by s.name),'[]'::jsonb))
 from jmax_app.memberships m join public.people p on p.id=m.person_id
 join public.stores s on s.id=m.location_id
 join public.store_roles sr on sr.person_id=m.person_id and sr.store_id=m.location_id and sr.role=m.role
 where p.auth_user_id=p_auth_user_id and p.active and s.active and jmax_app.can_manage(m,m.area);
$$;

create function public.jmax_shared_workspace(p_auth_user_id uuid,p_location_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m jmax_app.memberships; l jmax_app.locations; w jsonb; record_count integer;
begin
 select * into l from jmax_app.locations where location_id=p_location_id for share;
 m:=jmax_app.require_member(p_auth_user_id,p_location_id);
 select count(*) into record_count from jmax_app.records r where r.location_id=p_location_id and jmax_app.can_manage(m,r.area);
 if record_count>3000 then raise sqlstate 'PT409' using message='This shared workspace needs an archive review before loading more records.'; end if;
 select jsonb_build_object(
  'location',jsonb_build_object('id',l.location_id,'name',s.name,'timezone',l.timezone,'weekStartsOn',l.week_starts_on,'revision',l.revision),
  'me',jmax_app.member_json(m,p.full_name),
  'members',(select coalesce(jsonb_agg(jmax_app.member_json(mm,pp.full_name) order by pp.full_name),'[]'::jsonb)
    from jmax_app.memberships mm join public.people pp on pp.id=mm.person_id
    where mm.location_id=p_location_id and pp.active and jmax_app.can_manage(mm,mm.area)
      and (jmax_app.can_manage(m,mm.area) or 'location.manage'=any(mm.capabilities))),
  'records',(select coalesce(jsonb_agg(jmax_app.record_json(r) order by r.updated_at desc),'[]'::jsonb)
    from jmax_app.records r where r.location_id=p_location_id and jmax_app.can_manage(m,r.area)),
  'formerMembers',(select coalesce(jsonb_agg(jsonb_build_object('id',former.actor_id,'name',former.actor_name)),'[]'::jsonb)
    from (select distinct on(h.actor_id) h.actor_id,h.actor_name from jmax_app.record_history h
      join jmax_app.records r on r.id=h.record_id and r.location_id=h.location_id
      where h.location_id=p_location_id and jmax_app.can_manage(m,r.area)
      order by h.actor_id,h.at desc) former)
 ) into w from public.stores s join public.people p on p.id=m.person_id where s.id=p_location_id;
 return jsonb_build_object('workspace',w,'membershipRevision',m.revision);
end $$;

create function public.jmax_shared_receipt(p_auth_user_id uuid,p_location_id text,p_request_id text,p_fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m jmax_app.memberships; prior jmax_app.command_receipts; r jmax_app.records;
begin
 m:=jmax_app.require_member(p_auth_user_id,p_location_id);
 select * into prior from jmax_app.command_receipts where location_id=p_location_id and actor_id=m.id and request_id=p_request_id;
 if not found then return null; end if;
 if prior.fingerprint<>p_fingerprint then raise sqlstate 'PT409' using message='This request identifier was already used for a different change.'; end if;
 select * into r from jmax_app.records where id=prior.result->>'recordId' and location_id=p_location_id;
 if not found or not jmax_app.can_manage(m,r.area) then raise sqlstate 'PT403' using message='This record is outside your current access.'; end if;
 return prior.result;
end $$;

create function public.jmax_shared_commit(
 p_auth_user_id uuid,p_location_id text,p_actor_id text,p_membership_revision integer,
 p_workspace_revision integer,p_request_id text,p_fingerprint text,p_action text,
 p_record_id text,p_records jsonb,p_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m jmax_app.memberships; l jmax_app.locations; old_record jmax_app.records;
 candidate jsonb; prior jsonb; result jsonb; owner_member jmax_app.memberships;
 old_history jsonb; new_history jsonb; actor_name text; next_revision integer;
begin
 -- A restaurant lock serializes writers; retries race safely on the same receipt.
 select * into l from jmax_app.locations where location_id=p_location_id for update;
 m:=jmax_app.require_member(p_auth_user_id,p_location_id);
 if m.id is distinct from p_actor_id then raise sqlstate 'PT403' using message='The signed-in account does not match this save.'; end if;
 prior:=public.jmax_shared_receipt(p_auth_user_id,p_location_id,p_request_id,p_fingerprint);
 if prior is not null then return prior; end if;
 if m.revision is distinct from p_membership_revision or l.revision is distinct from p_workspace_revision then
  raise sqlstate 'PT409' using message='This workspace or your access changed. Refresh before saving.';
 end if;
 if p_action not in ('managerlog.create','managerlog.note') or p_action is null
  or jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)<>1
  or p_request_id is null or length(p_request_id) not between 1 and 200
  or p_record_id is null or length(p_record_id) not between 1 and 200
  or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' or p_at is null
 then raise sqlstate 'PT400' using message='This shared save is not supported.'; end if;
 candidate:=p_records->0;
 if jsonb_typeof(candidate) is distinct from 'object'
  or jsonb_typeof(candidate->'revision') is distinct from 'number'
  or (candidate->>'revision') !~ '^[1-9][0-9]{0,8}$'
  or jsonb_typeof(candidate->'data') is distinct from 'object'
 then raise sqlstate 'PT400' using message='The shared record has an invalid shape or revision.'; end if;
 if candidate->>'id' is distinct from p_record_id or candidate->>'locationId' is distinct from p_location_id
  or candidate->>'kind' is distinct from 'managerlog' or length(p_record_id) not between 1 and 200
  or not jmax_app.can_manage(m,candidate->>'area') or octet_length(candidate::text)>512000
 then raise sqlstate 'PT403' using message='This record is outside your access.'; end if;
 select mm.* into owner_member from jmax_app.memberships mm join public.people pp on pp.id=mm.person_id
 join public.store_roles sr on sr.person_id=mm.person_id and sr.store_id=mm.location_id and sr.role=mm.role
 where mm.id=candidate->>'ownerId' and mm.location_id=p_location_id and pp.active
 for share of mm,pp,sr;
 if not found or not jmax_app.can_manage(owner_member,candidate->>'area') then
  raise sqlstate 'PT409' using message='The responsible manager changed. Refresh before saving.';
 end if;
 select * into old_record from jmax_app.records where id=p_record_id for update;
 if p_action='managerlog.create' then
  if found then raise sqlstate 'PT409' using message='This record already exists.'; end if;
  next_revision:=1; old_history:='[]'::jsonb;
 else
  if not found or old_record.location_id<>p_location_id or not jmax_app.can_manage(m,old_record.area) then
   raise sqlstate 'PT404' using message='Record not found.';
  end if;
  next_revision:=old_record.revision+1; old_history:=old_record.data->'history';
  if candidate->>'area' is distinct from old_record.area or candidate->>'ownerId' is distinct from old_record.owner_id
    or (candidate->'data')-'history' is distinct from old_record.data-'history' then
   raise sqlstate 'PT400' using message='A note cannot replace the saved Manager Log entry.';
  end if;
 end if;
 if (candidate->>'revision')::integer is distinct from next_revision then
  raise sqlstate 'PT409' using message='This record changed. Refresh before saving.';
 end if;
 new_history:=candidate->'data'->'history';
 if jsonb_typeof(new_history) is distinct from 'array'
  or jsonb_array_length(new_history)<>jsonb_array_length(old_history)+1
  or (new_history-(jsonb_array_length(new_history)-1)) is distinct from old_history
  or new_history->-1->>'actorId' is distinct from m.id
  or new_history->-1->>'action' is distinct from (case when p_action='managerlog.create' then 'created' else 'note' end)
  or (new_history->-1->>'at')::timestamptz is distinct from p_at
  or (candidate->>'updatedAt')::timestamptz is distinct from p_at
 then raise sqlstate 'PT400' using message='The saved history must be preserved.'; end if;
 select full_name into actor_name from public.people where id=m.person_id;
 insert into jmax_app.records(id,location_id,owner_id,area,kind,revision,data,updated_at)
 values(p_record_id,p_location_id,candidate->>'ownerId',candidate->>'area','managerlog',next_revision,candidate->'data',p_at)
 on conflict(id) do update set revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at;
 update jmax_app.locations set revision=revision+1 where location_id=p_location_id;
 result:=jsonb_build_object('recordId',p_record_id,'revision',next_revision,'workspaceRevision',l.revision+1);
 insert into jmax_app.record_history(location_id,record_id,revision,actor_id,actor_name,action,at,snapshot)
 values(p_location_id,p_record_id,next_revision,m.id,actor_name,p_action,p_at,candidate);
 insert into jmax_app.command_receipts(location_id,actor_id,request_id,fingerprint,result)
 values(p_location_id,m.id,p_request_id,p_fingerprint,result);
 insert into jmax_app.audit_events(location_id,actor_id,action,record_id,revision,at)
 values(p_location_id,m.id,p_action,p_record_id,l.revision+1,p_at);
 return result;
end $$;

-- Functions otherwise receive EXECUTE for PUBLIC by default. Never expose the
-- trusted-server commit to browser roles: p_auth_user_id is verified by server.
revoke all on all functions in schema jmax_app from public,anon,authenticated,service_role;
revoke all on function public.jmax_shared_memberships(uuid) from public,anon,authenticated;
revoke all on function public.jmax_shared_workspace(uuid,text) from public,anon,authenticated;
revoke all on function public.jmax_shared_receipt(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.jmax_shared_commit(uuid,text,text,integer,integer,text,text,text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.jmax_shared_memberships(uuid) to service_role;
grant execute on function public.jmax_shared_workspace(uuid,text) to service_role;
grant execute on function public.jmax_shared_receipt(uuid,text,text,text) to service_role;
grant execute on function public.jmax_shared_commit(uuid,text,text,integer,integer,text,text,text,text,jsonb,timestamptz) to service_role;
commit;
