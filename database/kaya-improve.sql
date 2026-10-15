-- Monitor-only data. Access requires a dedicated server-held secret header.
create table public.mw_improve_settings (
 id boolean primary key default true check(id), revision integer not null default 1,
 config jsonb not null, updated_at timestamptz not null default now(), updated_by text not null
);
create table public.mw_improve_versions (
 id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
 actor text not null, revision integer not null, before_config jsonb not null, after_config jsonb not null,
 restored_from uuid
);
create table public.mw_improve_runs (
 id text primary key, kind text not null, started_at timestamptz not null default now(),
 finished_at timestamptz, status text not null, summary jsonb, error text
);
create table public.mw_improve_reviews (
 phone text primary key, fingerprint text not null, outcome text not null,
 findings jsonb not null, verification_note text not null, reviewed_at timestamptz not null default now()
);
alter table public.mw_improve_settings enable row level security;
alter table public.mw_improve_versions enable row level security;
alter table public.mw_improve_runs enable row level security;
alter table public.mw_improve_reviews enable row level security;
-- Replace SERVER_SECRET_SHA256 during provisioning. Never store the plaintext secret in SQL.
create policy server_only on public.mw_improve_settings for all to anon using (encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-kaya-improve-secret',''),'UTF8')),'hex') = 'SERVER_SECRET_SHA256') with check (encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-kaya-improve-secret',''),'UTF8')),'hex') = 'SERVER_SECRET_SHA256');
create policy server_only on public.mw_improve_versions for all to anon using (encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-kaya-improve-secret',''),'UTF8')),'hex') = 'SERVER_SECRET_SHA256') with check (encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-kaya-improve-secret',''),'UTF8')),'hex') = 'SERVER_SECRET_SHA256');
create policy server_only on public.mw_improve_runs for all to anon using (encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-kaya-improve-secret',''),'UTF8')),'hex') = 'SERVER_SECRET_SHA256') with check (encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-kaya-improve-secret',''),'UTF8')),'hex') = 'SERVER_SECRET_SHA256');
create policy server_only on public.mw_improve_reviews for all to anon using (encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-kaya-improve-secret',''),'UTF8')),'hex') = 'SERVER_SECRET_SHA256') with check (encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-kaya-improve-secret',''),'UTF8')),'hex') = 'SERVER_SECRET_SHA256');
grant select,insert,update,delete on public.mw_improve_settings,public.mw_improve_versions,public.mw_improve_runs,public.mw_improve_reviews to anon;
create index mw_improve_runs_started on public.mw_improve_runs(started_at desc);
create index mw_improve_reviews_reviewed on public.mw_improve_reviews(reviewed_at desc);

-- One transaction: lock current settings, back up both versions, then apply.
create function public.kaya_improve_save(expected_revision integer, next_config jsonb, actor_name text, restore_version uuid default null)
returns integer language plpgsql security invoker set search_path = public as $$
declare old_row public.mw_improve_settings; target jsonb;
begin
 select * into old_row from public.mw_improve_settings where id=true for update;
 if old_row.revision is null then raise exception 'Settings unavailable'; end if;
 if old_row.revision <> expected_revision then raise exception 'Settings changed. Refresh before saving.'; end if;
 target := next_config;
 if restore_version is not null then
  select before_config into target from public.mw_improve_versions where id=restore_version;
  if target is null then raise exception 'Restore point not found'; end if;
 end if;
 insert into public.mw_improve_versions(actor,revision,before_config,after_config,restored_from)
 values(actor_name,old_row.revision+1,old_row.config,target,restore_version);
 update public.mw_improve_settings set config=target,revision=old_row.revision+1,updated_at=now(),updated_by=actor_name where id=true;
 return old_row.revision+1;
end $$;
revoke all on function public.kaya_improve_save(integer,jsonb,text,uuid) from public;
grant execute on function public.kaya_improve_save(integer,jsonb,text,uuid) to anon;
