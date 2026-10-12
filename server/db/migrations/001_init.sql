-- SwamiJet server schema v1: one row per app record, server-set versions and times.

create table users (
  id                bigserial primary key,
  member_id         text unique,                 -- id of the matching record in module 'team'
  username          text not null unique,        -- stored lower-case
  name              text,
  role              text not null default 'Staff',
  active            boolean not null default true,
  pw_scrypt         text,                        -- "scrypt$N$r$p$salt$hash"
  pw_legacy_sha256  text,                        -- old app hash; replaced by scrypt at next login
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table sessions (
  token_hash    text primary key,                -- sha256 of the bearer token
  user_id       bigint not null references users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  last_seen_at  timestamptz not null default now(),
  user_agent    text
);
create index sessions_user_idx on sessions(user_id);

create sequence change_seq;

create table records (
  module      text        not null,
  id          text        not null,
  data        jsonb       not null,
  deleted     boolean     not null default false,
  version     integer     not null default 1,
  seq         bigint      not null default nextval('change_seq'),
  updated_at  timestamptz not null default now(),
  updated_by  bigint      references users(id) on delete set null,
  primary key (module, id)
);
create index records_seq_idx on records(seq);

-- Every overwritten or removed version, for restore and audit.
create table records_history (
  hid          bigserial primary key,
  module       text        not null,
  id           text        not null,
  data         jsonb       not null,
  deleted      boolean     not null,
  version      integer     not null,
  updated_at   timestamptz not null,
  updated_by   bigint,
  archived_at  timestamptz not null default now()
);
create index records_history_lookup_idx on records_history(module, id, archived_at desc);
create index records_history_time_idx on records_history(archived_at);

create function keep_record_history() returns trigger language plpgsql as $$
begin
  insert into records_history(module, id, data, deleted, version, updated_at, updated_by)
  values (old.module, old.id, old.data, old.deleted, old.version, old.updated_at, old.updated_by);
  return null;
end $$;

create trigger records_history_trg
  after update or delete on records
  for each row execute function keep_record_history();

-- Writes the server refused or overrode, so they can be reviewed.
create table sync_events (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  user_id     bigint,
  module      text,
  record_id   text,
  kind        text not null,      -- conflict-applied | conflict-rejected | denied | bulk-delete-blocked | invalid
  detail      text
);
create index sync_events_at_idx on sync_events(at desc);
