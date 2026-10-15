-- Apply only after all server clients include x-kaya-improve-secret.
-- Prevent public-key access to customer records, credentials and roles.
do $$ declare e text; t text; begin
 select pg_get_expr(polqual,polrelid) into e from pg_policy where polrelid='public.mw_improve_settings'::regclass and polname='server_only';
 if e is null then raise exception 'Server access policy required'; end if;
 foreach t in array array['mw_whatsapp','mw_monitor_users','mw_monitor_logins'] loop
  execute format('create policy kaya_server_only on public.%I for all to anon using (%s) with check (%s)',t,e,e);
  execute format('alter table public.%I enable row level security',t);
 end loop;
end $$;
