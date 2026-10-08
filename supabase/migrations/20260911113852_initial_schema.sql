create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create type public.group_role as enum ('owner', 'admin', 'member');
create type public.preferred_position as enum ('goalkeeper', 'defense', 'midfield', 'attack', 'any');
create type public.match_status as enum ('draft', 'drawn', 'completed', 'cancelled');
create type public.attendance_status as enum ('pending', 'present', 'absent');
create type public.assignment_source as enum ('draw', 'manual');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (
    display_name is null or char_length(btrim(display_name)) between 2 and 80
  )
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  default_players_on_court smallint not null default 5,
  sport text not null default 'futsal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint groups_name_length check (char_length(btrim(name)) between 2 and 80),
  constraint groups_sport_length check (char_length(btrim(sport)) between 2 and 40),
  constraint groups_players_on_court_range check (default_players_on_court between 1 and 20)
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.group_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null,
  nickname text,
  skill_rating numeric(2, 1) not null default 3.0,
  is_goalkeeper boolean not null default false,
  preferred_position public.preferred_position,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint players_name_length check (char_length(btrim(name)) between 2 and 80),
  constraint players_nickname_length check (
    nickname is null or char_length(btrim(nickname)) between 1 and 40
  ),
  constraint players_skill_range check (skill_rating between 1.0 and 5.0),
  constraint players_skill_half_step check ((skill_rating * 2) = trunc(skill_rating * 2)),
  unique (group_id, id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name text,
  match_date date not null,
  match_time time,
  team_count smallint not null default 2,
  players_on_court smallint not null default 5,
  status public.match_status not null default 'draft',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matches_name_length check (
    name is null or char_length(btrim(name)) between 2 and 100
  ),
  constraint matches_team_count check (team_count in (2, 3)),
  constraint matches_players_on_court_range check (players_on_court between 1 and 20),
  unique (group_id, id)
);

create table public.match_players (
  group_id uuid not null,
  match_id uuid not null,
  player_id uuid not null,
  attendance_status public.attendance_status not null default 'pending',
  player_name_snapshot text not null,
  player_nickname_snapshot text,
  skill_rating_snapshot numeric(2, 1) not null,
  is_goalkeeper_snapshot boolean not null,
  preferred_position_snapshot public.preferred_position,
  created_at timestamptz not null default now(),
  primary key (match_id, player_id),
  unique (group_id, match_id, player_id),
  constraint match_players_match_fk
    foreign key (group_id, match_id) references public.matches (group_id, id) on delete cascade,
  constraint match_players_player_fk
    foreign key (group_id, player_id) references public.players (group_id, id),
  constraint match_players_name_length check (
    char_length(btrim(player_name_snapshot)) between 2 and 80
  ),
  constraint match_players_nickname_length check (
    player_nickname_snapshot is null
    or char_length(btrim(player_nickname_snapshot)) between 1 and 40
  ),
  constraint match_players_skill_range check (skill_rating_snapshot between 1.0 and 5.0),
  constraint match_players_skill_half_step check (
    (skill_rating_snapshot * 2) = trunc(skill_rating_snapshot * 2)
  )
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  match_id uuid not null,
  team_index smallint not null,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  constraint teams_match_fk
    foreign key (group_id, match_id) references public.matches (group_id, id) on delete cascade,
  constraint teams_index_positive check (team_index > 0),
  constraint teams_name_length check (char_length(btrim(name)) between 1 and 40),
  constraint teams_color_length check (color is null or char_length(btrim(color)) between 1 and 30),
  unique (match_id, team_index),
  unique (group_id, match_id, id)
);

create table public.team_assignments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  match_id uuid not null,
  team_id uuid not null,
  player_id uuid not null,
  starts_as_reserve boolean not null default false,
  assignment_source public.assignment_source not null default 'draw',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_assignments_team_fk
    foreign key (group_id, match_id, team_id)
    references public.teams (group_id, match_id, id) on delete cascade,
  constraint team_assignments_participant_fk
    foreign key (group_id, match_id, player_id)
    references public.match_players (group_id, match_id, player_id) on delete cascade,
  unique (match_id, player_id)
);

create table public.draw_runs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  match_id uuid not null,
  run_number integer not null,
  seed text not null,
  algorithm_version text not null,
  balance_score numeric(8, 3),
  accepted boolean not null default false,
  created_at timestamptz not null default now(),
  constraint draw_runs_match_fk
    foreign key (group_id, match_id) references public.matches (group_id, id) on delete cascade,
  constraint draw_runs_number_positive check (run_number > 0),
  constraint draw_runs_seed_not_blank check (char_length(btrim(seed)) > 0),
  constraint draw_runs_algorithm_not_blank check (char_length(btrim(algorithm_version)) > 0),
  constraint draw_runs_balance_nonnegative check (balance_score is null or balance_score >= 0),
  unique (match_id, run_number)
);

create index group_members_user_group_idx on public.group_members (user_id, group_id);
create index groups_created_by_idx on public.groups (created_by);
create index players_group_active_name_idx on public.players (group_id, active, name);
create index matches_group_date_created_idx
  on public.matches (group_id, match_date desc, created_at desc);
create index matches_created_by_idx on public.matches (created_by);
create index match_players_group_player_idx
  on public.match_players (group_id, player_id);
create index teams_group_match_idx on public.teams (group_id, match_id);
create index team_assignments_team_idx on public.team_assignments (match_id, team_id);
create index team_assignments_group_player_idx
  on public.team_assignments (group_id, player_id);
create index team_assignments_participant_fk_idx
  on public.team_assignments (group_id, match_id, player_id);
create index team_assignments_team_fk_idx
  on public.team_assignments (group_id, match_id, team_id);
create index draw_runs_group_match_number_idx
  on public.draw_runs (group_id, match_id, run_number desc);
