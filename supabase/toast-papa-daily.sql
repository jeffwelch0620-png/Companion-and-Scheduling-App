-- Papa uses its existing credential set in toast-standard-sync.
-- Reuse the server token already saved in Vault; never copy it into this script.
begin;
do $$ begin
 if not exists(select 1 from vault.secrets where name='jmax_toast_scheduler_token') then
  raise exception 'Existing private Toast scheduler credential is missing';
 end if;
end $$;
select cron.schedule('jmax-toast-papa-daily','20 10 * * *',
 $job$select net.http_post(
  url:='https://yrlhwcoirgqmtlvvnzvo.supabase.co/functions/v1/toast-standard-sync',
  headers:=case when left((select decrypted_secret from vault.decrypted_secrets where name='jmax_toast_scheduler_token'),10)='sb_secret_' then jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='jmax_toast_scheduler_token')) else jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='jmax_toast_scheduler_token')) end,
  body:=jsonb_build_object('target','papa','businessDate',to_char((now() at time zone 'America/New_York')::date-1,'YYYYMMDD')),
  timeout_milliseconds:=120000
 );$job$);
commit;
