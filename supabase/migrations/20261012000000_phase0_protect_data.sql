-- SwamiJet Phase 0: protect the data (docs/BACKEND_PLAN.md)
-- Run once in Supabase Dashboard > SQL Editor. Safe to re-run.
--
-- Adds, without changing how the app reads or writes:
--   1. ops.app_data_backup_20261012  one-time full copy of app_data
--   2. ops.app_data_history          previous version of a module before it changes
--   3. wipe guard                     skips writes that shrink a module sharply or empty the team
--   4. ops.restore_app_data()         put a module back to how it was at a given time
--   5. ops.reset_member_password()    owner recovery (replaces the removed admin/admin123 login)
--   6. ops.prune_app_data_history()   keeps history size in check
--
-- Everything lives in schema "ops", which the public API key cannot reach.
-- Rollback: drop trigger app_data_guard on public.app_data;
--           drop trigger app_data_history on public.app_data;
--           (optional) drop schema ops cascade;  -- also deletes backup + history

create extension if not exists pgcrypto with schema extensions;

create schema if not exists ops;
revoke all on schema ops from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema ops from anon, authenticated';
  end if;
end $$;

-- 1. One-time backup ------------------------------------------------------------
do $$ begin
  if to_regclass('ops.app_data_backup_20261012') is null then
    create table ops.app_data_backup_20261012 as
      select key, value, updated_at, now() as backed_up_at from public.app_data;
  end if;
end $$;

-- 2. History ---------------------------------------------------------------------
create table if not exists ops.app_data_history (
  id               bigserial primary key,
  key              text        not null,
  value            jsonb       not null,
  value_updated_at timestamptz,
  archived_at      timestamptz not null default now(),
  reason           text        not null default 'change'
);
create index if not exists app_data_history_key_time_idx on ops.app_data_history (key, archived_at desc);

create table if not exists ops.app_data_guard_log (
  id              bigserial primary key,
  key             text        not null,
  old_count       int,
  new_count       int,
  reason          text        not null,
  attempted_value jsonb,
  blocked_at      timestamptz not null default now()
);

-- Rows still in use: not tombstoned and not deactivated.
create or replace function ops.live_count(v jsonb) returns int
language sql immutable as $$
  select case when jsonb_typeof(v) = 'array' then
    (select count(*)::int from jsonb_array_elements(v) e
      where coalesce(e->>'_del', 'false') not in ('true', '1')
        and coalesce(e->>'active', 'true') <> 'false')
  else null end
$$;

-- 3. Wipe guard (BEFORE UPDATE): returning NULL skips that row's update and
-- keeps the stored value; other rows in the same upsert still save.
-- Keys trimmed on purpose by the app are exempt from the shrink rule.
create or replace function ops.app_data_guard() returns trigger
language plpgsql security definer set search_path = ops, public, pg_temp as $$
declare
  old_n int; new_n int; why text;
begin
  if coalesce(current_setting('swamijet.allow_shrink', true), '') = 'on' then
    return new;
  end if;
  if new.value is not distinct from old.value then
    return new;
  end if;

  if jsonb_typeof(old.value) = 'array' and jsonb_typeof(new.value) <> 'array' then
    why := 'type changed from array to ' || jsonb_typeof(new.value);
  elsif jsonb_typeof(old.value) = 'array' then
    old_n := ops.live_count(old.value);
    new_n := ops.live_count(new.value);
    if new.key = 'team' and old_n > 0 and new_n = 0 then
      why := 'team would become empty';
    elsif new.key not in ('activityLog', 'notifications', 'scoreCache')
          and old_n >= 10 and new_n < old_n * 0.8 then
      why := format('live rows would drop from %s to %s', old_n, new_n);
    end if;
  end if;

  if why is not null then
    insert into ops.app_data_guard_log (key, old_count, new_count, reason, attempted_value)
    values (new.key, old_n, new_n, why, new.value);
    return null;
  end if;
  return new;
end $$;

-- History (AFTER UPDATE): keep the previous value. A change that lowers the
-- live row count is always kept; other changes at most once per 5 minutes
-- per key, so frequent saves do not fill the database.
create or replace function ops.app_data_keep_history() returns trigger
language plpgsql security definer set search_path = ops, public, pg_temp as $$
declare
  shrank boolean;
begin
  if new.value is not distinct from old.value then
    return null;
  end if;
  shrank := coalesce(ops.live_count(new.value) < ops.live_count(old.value), false);
  if shrank or not exists (
       select 1 from ops.app_data_history h
        where h.key = old.key and h.archived_at > now() - interval '5 minutes') then
    insert into ops.app_data_history (key, value, value_updated_at, reason)
    values (old.key, old.value, old.updated_at, case when shrank then 'shrink' else 'change' end);
  end if;
  return null;
end $$;

drop trigger if exists app_data_guard on public.app_data;
create trigger app_data_guard
  before update on public.app_data
  for each row execute function ops.app_data_guard();

drop trigger if exists app_data_history on public.app_data;
create trigger app_data_history
  after update on public.app_data
  for each row execute function ops.app_data_keep_history();

-- 4. Restore a module to how it was at p_at --------------------------------------
-- The value current at p_at is the first history row archived after p_at.
-- Phones merge rather than replace, so a restore brings rows back; it never
-- removes rows a phone still holds.
create or replace function ops.restore_app_data(p_key text, p_at timestamptz)
returns text
language plpgsql security definer set search_path = ops, public, pg_temp as $$
declare
  v jsonb; ts timestamptz;
begin
  select h.value, h.archived_at into v, ts
    from ops.app_data_history h
   where h.key = p_key and h.archived_at > p_at
   order by h.archived_at asc
   limit 1;
  if v is null then
    return format('No change to %s after %s: the current value is already that version.', p_key, p_at);
  end if;
  perform set_config('swamijet.allow_shrink', 'on', true);
  update public.app_data set value = v, updated_at = now() where key = p_key;
  return format('Restored %s to the version replaced at %s (%s live rows).', p_key, ts, ops.live_count(v));
end $$;

-- 5. Owner recovery: set a member's password (stored as the SHA-256 hex the app checks).
create or replace function ops.reset_member_password(p_username text, p_new_password text)
returns text
language plpgsql security definer set search_path = ops, public, extensions, pg_temp as $$
declare
  team jsonb; hit int; stamp text;
begin
  if length(trim(coalesce(p_new_password, ''))) < 6 then
    raise exception 'Password must be at least 6 characters';
  end if;
  stamp := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  select value into team from public.app_data where key = 'team' for update;
  select count(*) into hit from jsonb_array_elements(team) e
   where lower(trim(e->>'username')) = lower(trim(p_username));
  if hit = 0 then
    return format('No member with username %s', p_username);
  end if;
  update public.app_data
     set value = (
       select jsonb_agg(case when lower(trim(e->>'username')) = lower(trim(p_username))
         then e || jsonb_build_object(
                'password', encode(digest(trim(p_new_password), 'sha256'), 'hex'),
                'active', true, '_up', stamp)
         else e end order by ord)
       from jsonb_array_elements(team) with ordinality as t(e, ord)),
         updated_at = now()
   where key = 'team';
  return format('Password reset for %s. They can log in after their app syncs.', p_username);
end $$;

-- 6. History retention: everything for 14 days, then the last version of each
-- key per day up to 90 days. Shrink snapshots are kept for the full 90 days.
create or replace function ops.prune_app_data_history()
returns int
language plpgsql security definer set search_path = ops, public, pg_temp as $$
declare n int;
begin
  delete from ops.app_data_history h
   where h.archived_at < now() - interval '90 days'
      or (h.archived_at < now() - interval '14 days'
          and h.reason <> 'shrink'
          and h.id <> (select h2.id from ops.app_data_history h2
                        where h2.key = h.key
                          and date_trunc('day', h2.archived_at) = date_trunc('day', h.archived_at)
                        order by h2.archived_at desc limit 1));
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on all tables in schema ops from public;
revoke all on all functions in schema ops from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema ops from anon, authenticated';
    execute 'revoke all on all functions in schema ops from anon, authenticated';
  end if;
end $$;

-- Optional, if the pg_cron extension is enabled (Database > Extensions):
-- select cron.schedule('prune-app-data-history', '15 3 * * *', 'select ops.prune_app_data_history()');
