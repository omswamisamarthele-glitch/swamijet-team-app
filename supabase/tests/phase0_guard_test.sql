-- Phase 0 behaviour tests. NEVER run against production: writes test rows.
-- Needs a scratch Postgres database named swamijet_test with roles anon/authenticated,
-- supabase_setup.sql and the phase0 migration applied. See tests/README.md.
\set ON_ERROR_STOP 1
do $$ begin
  if current_database() <> 'swamijet_test' then
    raise exception 'Refusing to run: database must be named swamijet_test';
  end if;
end $$;

-- fixture
truncate public.app_data;
truncate ops.app_data_history, ops.app_data_guard_log;
insert into public.app_data(key, value) values
 ('team', '[{"id":1,"username":"owner","password":"x","active":true},{"id":2,"username":"tech","password":"y","active":true},{"id":3,"username":"old","active":false}]'),
 ('attendance', (select jsonb_agg(jsonb_build_object('id', g)) from generate_series(1, 20) g)),
 ('notifications', (select jsonb_agg(jsonb_build_object('id', g)) from generate_series(1, 50) g)),
 ('officeGps', '{"lat":18.5,"lng":73.8}');

-- everything below runs as the public API role, like the app
set role anon;

-- 1. normal save (adds a row) goes through
insert into public.app_data(key, value) values
 ('attendance', (select jsonb_agg(jsonb_build_object('id', g)) from generate_series(1, 21) g))
on conflict (key) do update set value = excluded.value;
reset role;
do $$ begin
  assert ops.live_count((select value from public.app_data where key = 'attendance')) = 21, 'normal save failed';
  assert (select count(*) from ops.app_data_history where key = 'attendance') = 1, 'history not kept';
end $$;
set role anon;

-- 2. sharp shrink is skipped, logged, stored value unchanged;
--    the good row in the same upsert still saves
insert into public.app_data(key, value) values
 ('attendance', '[{"id":1},{"id":2},{"id":3}]'),
 ('officeGps', '{"lat":19.0,"lng":72.8}')
on conflict (key) do update set value = excluded.value;
reset role;
do $$ begin
  assert ops.live_count((select value from public.app_data where key = 'attendance')) = 21, 'shrink was not blocked';
  assert (select value->>'lat' from public.app_data where key = 'officeGps') = '19.0', 'good row in same upsert lost';
  assert (select count(*) from ops.app_data_guard_log where key = 'attendance') = 1, 'block not logged';
end $$;
set role anon;

-- 3. soft-deleting every member is skipped
update public.app_data set value = '[{"id":1,"_del":true},{"id":2,"_del":true},{"id":3,"active":false}]' where key = 'team';
reset role;
do $$ begin
  assert ops.live_count((select value from public.app_data where key = 'team')) = 2, 'empty team was not blocked';
end $$;
set role anon;

-- 4. array replaced by an object is skipped
update public.app_data set value = '{}' where key = 'attendance';
reset role;
do $$ begin
  assert jsonb_typeof((select value from public.app_data where key = 'attendance')) = 'array', 'type change was not blocked';
end $$;
set role anon;

-- 5. trimmed keys may shrink
update public.app_data set value = '[{"id":1}]' where key = 'notifications';
reset role;
do $$ begin
  assert jsonb_array_length((select value from public.app_data where key = 'notifications')) = 1, 'trimmed key was blocked';
end $$;
set role anon;

-- 6. the public role cannot reach ops
do $$ begin
  begin
    perform count(*) from ops.app_data_history;
    raise exception 'anon could read ops.app_data_history';
  exception when insufficient_privilege then null;
  end;
  begin
    perform ops.restore_app_data('attendance', now());
    raise exception 'anon could call ops.restore_app_data';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 7. restore: wipe attendance with the guard bypassed, then restore it
select set_config('swamijet.allow_shrink', 'on', false);
update ops.app_data_history set archived_at = archived_at - interval '1 hour';  -- age out the 5-min throttle
update public.app_data set value = '[]' where key = 'attendance';
select set_config('swamijet.allow_shrink', '', false);
do $$ begin
  assert ops.live_count((select value from public.app_data where key = 'attendance')) = 0, 'setup wipe failed';
end $$;
select ops.restore_app_data('attendance', now() - interval '1 minute');
do $$ begin
  assert ops.live_count((select value from public.app_data where key = 'attendance')) = 21, 'restore failed';
end $$;

-- 8. password reset stores the SHA-256 hex the app compares against
select ops.reset_member_password('Owner', 'NewPass1');
do $$ begin
  assert (select e->>'password' from public.app_data, jsonb_array_elements(value) e
           where key = 'team' and e->>'username' = 'owner')
         = encode(extensions.digest('NewPass1', 'sha256'), 'hex'), 'reset hash mismatch';
  assert (select count(*) from public.app_data, jsonb_array_elements(value) e where key = 'team') = 3, 'reset changed member count';
end $$;

-- 9. prune runs
select ops.prune_app_data_history();

\echo 'phase0_guard_test: ALL PASSED'
