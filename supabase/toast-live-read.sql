-- Private integration objects. No browser/anonymous table access is added.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
alter table integrations.toast_report_payloads add column if not exists ingestion_metadata jsonb not null default '{}'::jsonb;

create or replace function public.jmax_toast_store_payloads(p_sync_run_id uuid,p_payloads jsonb)
returns integer language plpgsql security definer set search_path=integrations,pg_catalog as $$
declare v_count integer;
begin
 insert into toast_report_payloads(sync_run_id,toast_restaurant_guid,report_kind,business_date,payload,ingestion_metadata)
 select p_sync_run_id,item.toast_restaurant_guid,item.report_kind,item.business_date,item.payload,coalesce(item.ingestion_metadata,'{}'::jsonb)
 from jsonb_to_recordset(p_payloads) as item(toast_restaurant_guid uuid,report_kind text,business_date date,payload jsonb,ingestion_metadata jsonb);
 get diagnostics v_count=row_count;
 return v_count;
end $$;
revoke all on function public.jmax_toast_store_payloads(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.jmax_toast_store_payloads(uuid,jsonb) to service_role;

create or replace function public.jmax_toast_read_day(p_store_id text,p_business_date date)
returns jsonb language plpgsql security definer set search_path=integrations,public,pg_catalog as $$
declare restaurant uuid; feeds jsonb='{}'::jsonb; row record; kind text;
begin
 select toast_restaurant_guid into restaurant from integrations.toast_location_map where store_id=p_store_id;
 if restaurant is null then raise exception 'Unknown restaurant mapping'; end if;
 foreach kind in array array['sales','labor'] loop
  select p.* into row from integrations.toast_report_payloads p join integrations.toast_sync_runs r on r.id=p.sync_run_id
  where p.toast_restaurant_guid=restaurant and p.business_date=p_business_date and p.report_kind=kind and r.status='succeeded'
  order by r.finished_at desc,p.fetched_at desc,p.id desc limit 1;
  feeds=feeds||jsonb_build_object(case when kind='sales' then 'orders' else 'labor' end,
   case when row.id is null then null else jsonb_build_object(
    'recordCount',jsonb_array_length(row.payload),'checkedAt',row.fetched_at,'dataThrough',row.fetched_at,
    'paginationComplete',coalesce((row.ingestion_metadata->>'paginationComplete')::boolean,false),
    'correctionsApplied',false,'dayClosed',false) end);
 end loop;
 return jsonb_build_object('schemaVersion','jmax-toast-day-read.v1','locationId',p_store_id,'businessDate',p_business_date,
  'timezone','America/New_York','source',jsonb_build_object('system','toast','restaurantGuid',restaurant))||feeds;
end $$;
revoke all on function public.jmax_toast_read_day(text,date) from public,anon,authenticated;
grant execute on function public.jmax_toast_read_day(text,date) to service_role;

-- Only the existing server connector can initialize this. Its token stays in Vault.
create or replace function public.jmax_toast_enable_daily_sync(p_existing_server_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare secret_id uuid; job_id bigint;
begin
 if length(p_existing_server_token)<20 then raise exception 'Existing server token required'; end if;
 select id into secret_id from vault.secrets where name='jmax_toast_scheduler_token';
 if secret_id is null then
  perform vault.create_secret(p_existing_server_token,'jmax_toast_scheduler_token','Existing project server credential for private Toast daily sync');
 end if;
 select cron.schedule('jmax-toast-berts-rudds-daily','15 10 * * *',
  $job$select net.http_post(
   url:='https://yrlhwcoirgqmtlvvnzvo.supabase.co/functions/v1/toast-standard-sync',
   headers:=case when left((select decrypted_secret from vault.decrypted_secrets where name='jmax_toast_scheduler_token'),10)='sb_secret_' then jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='jmax_toast_scheduler_token')) else jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='jmax_toast_scheduler_token')) end,
   body:=jsonb_build_object('target','berts_rudds','businessDate',to_char((now() at time zone 'America/New_York')::date-1,'YYYYMMDD')),
   timeout_milliseconds:=120000
  );$job$) into job_id;
 return jsonb_build_object('jobId',job_id,'scheduleUtc','15 10 * * *','target','berts_rudds','credentialStored',true);
end $$;
revoke all on function public.jmax_toast_enable_daily_sync(text) from public,anon,authenticated;
grant execute on function public.jmax_toast_enable_daily_sync(text) to service_role;
commit;
