# SwamiJet Runbook

Run all SQL in Supabase Dashboard > SQL Editor (project `cvcrffxonrmtyaklhgbl`).

## Apply Phase 0 (one time)
1. Open `supabase/migrations/20261012000000_phase0_protect_data.sql`, paste it all, Run. Safe to re-run.
2. Check it worked:
   ```sql
   select count(*) from ops.app_data_backup_20261012;   -- equals number of rows in app_data
   select tgname from pg_trigger where tgrelid = 'public.app_data'::regclass and not tgisinternal;
   -- app_data_guard, app_data_history
   ```
3. Optional nightly history cleanup (needs Database > Extensions > pg_cron enabled):
   ```sql
   select cron.schedule('prune-app-data-history', '15 3 * * *', 'select ops.prune_app_data_history()');
   ```

## Check for blocked writes
The guard skips any save that would drop a module's live rows by more than 20% (modules with 10+ rows),
empty the team, or replace a list with something else. Phones keep their data and retry.
```sql
select blocked_at, key, old_count, new_count, reason from ops.app_data_guard_log order by blocked_at desc limit 20;
```
A row here means some phone tried to overwrite cloud data with a much smaller copy. Find out which device
(time of day, who was working) before allowing anything.

## Restore a module
See what versions exist, then restore to a time before the bad change (times are UTC):
```sql
select archived_at, reason, ops.live_count(value) as live_rows
  from ops.app_data_history where key = 'attendance' order by archived_at desc limit 20;

select ops.restore_app_data('attendance', '2026-10-12 06:00:00+00');
```
Phones merge cloud data into their own, so a restore brings records back but never deletes records a phone still holds.

Full one-time backup from before Phase 0: `ops.app_data_backup_20261012`.

## Reset a member's password (replaces the removed admin/admin123 login)
```sql
select ops.reset_member_password('owner', 'NewStrongPass1');
```
The member logs in with the new password once their phone has synced (open the app online).

## Security note
If any real account still uses the username `admin` with password `admin123`, change it now
(Profile > change password, or the reset above). Removing the backdoor does not change existing passwords.

## Undo Phase 0
```sql
drop trigger if exists app_data_guard on public.app_data;
drop trigger if exists app_data_history on public.app_data;
```
Keep schema `ops` (backup + history) unless you are sure it is not needed.
