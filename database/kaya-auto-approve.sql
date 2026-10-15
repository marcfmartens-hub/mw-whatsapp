create table public.mw_improve_proposals (
 id text primary key, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 status text not null, severity text not null, phrase text, intent text, reason text not null,
 evidence jsonb not null, validation jsonb, release_id uuid
);
create table public.mw_improve_releases (
 id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
 status text not null, severity text not null, base_sha text, head_sha text, merge_sha text, pr_number bigint,
 proposal_ids jsonb not null default '[]', backup jsonb not null, candidate jsonb not null,
 validation jsonb not null, error text, published_at timestamptz, rollback_of uuid, actor text
);
create table public.mw_improve_leases (id text primary key, token uuid not null, expires_at timestamptz not null);
alter table public.mw_improve_proposals enable row level security;
alter table public.mw_improve_releases enable row level security;
alter table public.mw_improve_leases enable row level security;
-- Reuse the already-provisioned server-header policy, without changing or exposing its secret.
do $$ declare access_expression text; table_name text; begin
 select pg_get_expr(polqual,polrelid) into access_expression from pg_policy where polrelid='public.mw_improve_settings'::regclass and polname='server_only';
 if access_expression is null then raise exception 'Existing server policy required'; end if;
 foreach table_name in array array['mw_improve_proposals','mw_improve_releases','mw_improve_leases'] loop
  execute format('create policy server_only on public.%I for all to anon using (%s) with check (%s)',table_name,access_expression,access_expression);
  execute format('grant select,insert,update,delete on public.%I to anon',table_name);
 end loop;
end $$;
create index mw_improve_proposals_status on public.mw_improve_proposals(status,created_at);
create index mw_improve_releases_status on public.mw_improve_releases(status,created_at);
create function public.kaya_improve_lease(lease_name text, holder uuid, release_lease boolean default false)
returns boolean language plpgsql security invoker set search_path=public as $$
declare claimed uuid;
begin
 if release_lease then delete from public.mw_improve_leases where id=lease_name and token=holder; return found; end if;
 insert into public.mw_improve_leases(id,token,expires_at) values(lease_name,holder,now()+interval '15 minutes')
 on conflict(id) do update set token=excluded.token,expires_at=excluded.expires_at where mw_improve_leases.expires_at<now()
 returning token into claimed;
 return claimed=holder;
end $$;
revoke all on function public.kaya_improve_lease(text,uuid,boolean) from public;
grant execute on function public.kaya_improve_lease(text,uuid,boolean) to anon;
create table public.mw_improve_connection(id boolean primary key default true check(id),hook_id bigint not null,checked_at timestamptz not null default now());
alter table public.mw_improve_connection enable row level security;
do $$ declare e text; begin
 select pg_get_expr(polqual,polrelid) into e from pg_policy where polrelid='public.mw_improve_settings'::regclass and polname='server_only';
 execute format('create policy server_only on public.mw_improve_connection for all to anon using (%s) with check (%s)',e,e);
end $$;
grant select,insert,update,delete on public.mw_improve_connection to anon;
