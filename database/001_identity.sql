-- Fresh DEV database only. Run by a separate migration identity with CREATEROLE.
-- No password/LOGIN is created here. Runtime login provision belongs to runtime secrets.
begin;
create role futebol_owner nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role futebol_runtime nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
-- Managed PG migration logins are not superusers: explicit membership is needed
-- for schema ownership and SET ROLE. This is never granted to runtime logins.
grant futebol_owner to current_user;
revoke create on schema public from public;
create schema private authorization futebol_owner;
alter schema public owner to futebol_owner;
set local role futebol_owner;
revoke all on schema private from public;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;

create table private.app_users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);
create table private.external_identities (
  issuer text not null check (length(issuer) between 1 and 512),
  subject text not null check (length(subject) between 1 and 256),
  user_id uuid not null unique references private.app_users(id),
  created_at timestamptz not null default now(),
  primary key (issuer, subject)
);
alter table private.app_users enable row level security;
alter table private.external_identities enable row level security;

create function private.actor_id() returns uuid language sql stable security definer
set search_path = pg_catalog as $$
  select u.id from private.app_users u
  where u.id = nullif(current_setting('futebol.actor_id', true), '')::uuid
    and u.disabled_at is null
$$;
revoke all on function private.actor_id() from public;
grant usage on schema public, private to futebol_runtime;
grant execute on function private.actor_id() to futebol_runtime;
commit;
