-- STAGED UPGRADE, NOT APPLIED. Install after the shared Manager Log migration.
-- No real people, owner identities or grants are inferred/seeded here.
-- Provision verified auth UUIDs through the trusted installation process only.
begin;
create table jmax_app.restaurant_access (
 auth_user_id uuid primary key references auth.users(id),
 kind text not null check(kind in ('restaurant','jay','rudd','commissary')),
 home_location_id text not null references jmax_app.locations(location_id),
 revision integer not null default 1 check(revision>0),
 check(kind<>'commissary' or home_location_id='comm')
);
create unique index restaurant_access_owner_seats on jmax_app.restaurant_access(kind) where kind in ('jay','rudd');
alter table jmax_app.restaurant_access enable row level security;
revoke all on jmax_app.restaurant_access from public,anon,authenticated,service_role;

create function jmax_app.restaurant_access_proof(p_auth_user_id uuid,p_location_id text default null)
returns jsonb language plpgsql set search_path='' as $$
declare a jmax_app.restaurant_access; home text; count_locations integer; proof jsonb;
begin
 -- Serialize membership/grant checks for this canonical person. Membership
 -- inserts use the FK lock on this row; authority cannot widen mid-transaction.
 perform 1 from public.people where auth_user_id=p_auth_user_id for update;
 select * into a from jmax_app.restaurant_access where auth_user_id=p_auth_user_id for share;
 if found then
  home:=a.home_location_id;
  proof:=jsonb_build_object('version',1,'kind',a.kind,'homeLocationId',home,'revision',a.revision);
 else
  -- A duplicated active membership must not implicitly become cross-store access.
  select count(distinct m.location_id),min(m.location_id) into count_locations,home
   from jmax_app.memberships m join public.people p on p.id=m.person_id
   join public.stores s on s.id=m.location_id
   join public.store_roles sr on sr.person_id=m.person_id and sr.store_id=m.location_id and sr.role=m.role
   where p.auth_user_id=p_auth_user_id and p.active and m.active and s.active;
  if count_locations>1 then raise sqlstate 'PT403' using message='Restaurant access needs a verified home restaurant.'; end if;
  if count_locations=0 then return null; end if;
  proof:=jsonb_build_object('version',1,'kind','restaurant','homeLocationId',home,'revision',0);
 end if;
 if p_location_id is not null and not (
   (proof->>'kind' in ('jay','rudd') and p_location_id in ('berts','rudds','papa','comm'))
   or (proof->>'kind' not in ('jay','rudd') and p_location_id=home)) then
  -- Commissary grants do not open Manager Log/personnel at destination restaurants.
  raise sqlstate 'PT403' using message='No Manager Log access to this restaurant.';
 end if;
 return proof;
end $$;

create or replace function jmax_app.require_member(p_auth_user_id uuid,p_location_id text)
returns jmax_app.memberships language plpgsql set search_path='' as $$
declare m jmax_app.memberships;
begin
 if jmax_app.restaurant_access_proof(p_auth_user_id,p_location_id) is null then
  raise sqlstate 'PT403' using message='No Manager Log access to this restaurant.';
 end if;
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

create or replace function public.jmax_shared_memberships(p_auth_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare proof jsonb; result jsonb;
begin
 proof:=jmax_app.restaurant_access_proof(p_auth_user_id);
 select jsonb_build_object('restaurantAccess',proof,'memberships',coalesce(jsonb_agg(jsonb_build_object(
  'id',m.id,'locationId',m.location_id,'name',p.full_name,'position',m.position,'locationName',s.name)
  order by s.name),'[]'::jsonb)) into result
 from jmax_app.memberships m join public.people p on p.id=m.person_id
 join public.stores s on s.id=m.location_id
 join public.store_roles sr on sr.person_id=m.person_id and sr.store_id=m.location_id and sr.role=m.role
 where p.auth_user_id=p_auth_user_id and p.active and s.active and jmax_app.can_manage(m,m.area)
 and ((proof->>'kind' in ('jay','rudd') and m.location_id in ('berts','rudds','papa','comm'))
   or (proof->>'kind' not in ('jay','rudd') and m.location_id=proof->>'homeLocationId'));
 return result;
end $$;
revoke all on function jmax_app.restaurant_access_proof(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.jmax_shared_memberships(uuid) from public,anon,authenticated;
grant execute on function public.jmax_shared_memberships(uuid) to service_role;
commit;
