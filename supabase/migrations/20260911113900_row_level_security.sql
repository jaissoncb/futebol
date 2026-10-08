alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.teams enable row level security;
alter table public.team_assignments enable row level security;
alter table public.draw_runs enable row level security;

create policy profiles_select_group_peers
on public.profiles for select
to authenticated
using (
  id = (select auth.uid())
  or private.shares_group_with(id)
);

create policy profiles_update_self
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy groups_select_members
on public.groups for select
to authenticated
using (private.is_group_member(id));

create policy groups_update_owner
on public.groups for update
to authenticated
using (private.is_group_owner(id))
with check (private.is_group_owner(id));

create policy groups_delete_owner
on public.groups for delete
to authenticated
using (private.is_group_owner(id));

create policy group_members_select_members
on public.group_members for select
to authenticated
using (private.is_group_member(group_id));

create policy group_members_insert_owner
on public.group_members for insert
to authenticated
with check (
  private.is_group_owner(group_id)
  and role in ('admin', 'member')
  and user_id <> (select auth.uid())
);

create policy group_members_update_owner
on public.group_members for update
to authenticated
using (
  private.is_group_owner(group_id)
  and role <> 'owner'
)
with check (
  private.is_group_owner(group_id)
  and role in ('admin', 'member')
);

create policy group_members_delete_owner
on public.group_members for delete
to authenticated
using (
  private.is_group_owner(group_id)
  and role <> 'owner'
);

create policy players_select_members
on public.players for select
to authenticated
using (private.is_group_member(group_id));

create policy players_insert_managers
on public.players for insert
to authenticated
with check (private.can_manage_group(group_id));

create policy players_update_managers
on public.players for update
to authenticated
using (private.can_manage_group(group_id))
with check (private.can_manage_group(group_id));

create policy matches_select_members
on public.matches for select
to authenticated
using (private.is_group_member(group_id));

create policy matches_insert_managers
on public.matches for insert
to authenticated
with check (
  private.can_manage_group(group_id)
  and created_by = (select auth.uid())
);

create policy matches_update_managers
on public.matches for update
to authenticated
using (private.can_manage_group(group_id))
with check (private.can_manage_group(group_id));

create policy matches_delete_owner
on public.matches for delete
to authenticated
using (private.is_group_owner(group_id));

create policy match_players_select_members
on public.match_players for select
to authenticated
using (private.is_group_member(group_id));

create policy match_players_insert_managers
on public.match_players for insert
to authenticated
with check (private.can_manage_match(group_id, match_id));

create policy match_players_update_managers
on public.match_players for update
to authenticated
using (private.can_manage_match(group_id, match_id))
with check (private.can_manage_match(group_id, match_id));

create policy match_players_delete_managers
on public.match_players for delete
to authenticated
using (private.can_manage_match(group_id, match_id));

create policy teams_select_members
on public.teams for select
to authenticated
using (private.is_group_member(group_id));

create policy teams_insert_managers
on public.teams for insert
to authenticated
with check (private.can_manage_match(group_id, match_id));

create policy teams_update_managers
on public.teams for update
to authenticated
using (private.can_manage_match(group_id, match_id))
with check (private.can_manage_match(group_id, match_id));

create policy teams_delete_managers
on public.teams for delete
to authenticated
using (private.can_manage_match(group_id, match_id));

create policy team_assignments_select_members
on public.team_assignments for select
to authenticated
using (private.is_group_member(group_id));

create policy team_assignments_insert_managers
on public.team_assignments for insert
to authenticated
with check (private.can_manage_match(group_id, match_id));

create policy team_assignments_update_managers
on public.team_assignments for update
to authenticated
using (private.can_manage_match(group_id, match_id))
with check (private.can_manage_match(group_id, match_id));

create policy team_assignments_delete_managers
on public.team_assignments for delete
to authenticated
using (private.can_manage_match(group_id, match_id));

create policy draw_runs_select_members
on public.draw_runs for select
to authenticated
using (private.is_group_member(group_id));

create policy draw_runs_insert_managers
on public.draw_runs for insert
to authenticated
with check (private.can_manage_match(group_id, match_id));

create policy draw_runs_update_managers
on public.draw_runs for update
to authenticated
using (private.can_manage_match(group_id, match_id))
with check (private.can_manage_match(group_id, match_id));
