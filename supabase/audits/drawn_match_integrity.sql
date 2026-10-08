-- READ ONLY. Run with an infrastructure role that sees all groups before a release.
-- Returns only identifiers/reasons; zero rows means no detected structural violation.
-- Does not repair rows or attest engine provenance of snapshots/assignment_source.
with graph as (
  select m.*,
    (select count(*) from public.match_players p where p.match_id=m.id) as participants,
    (select count(*) from public.match_players p where p.match_id=m.id and p.attendance_status<>'present') as not_present,
    (select count(*) from public.teams t where t.match_id=m.id) as teams,
    (select count(distinct t.team_index) from public.teams t where t.match_id=m.id
      and t.team_index between 1 and m.team_count) as valid_team_indexes,
    (select count(*) from public.team_assignments a where a.match_id=m.id) as assignments,
    (select count(distinct a.player_id) from public.team_assignments a where a.match_id=m.id) as assigned_players,
    (select count(*) from public.draw_runs r where r.match_id=m.id) as runs,
    (select count(distinct r.run_number) from public.draw_runs r where r.match_id=m.id) as distinct_runs,
    (select min(r.run_number) from public.draw_runs r where r.match_id=m.id) as first_run,
    (select max(r.run_number) from public.draw_runs r where r.match_id=m.id) as last_run,
    (select count(*) from public.draw_runs r where r.match_id=m.id and r.accepted) as accepted,
    (select max(r.run_number) from public.draw_runs r where r.match_id=m.id and r.accepted) as accepted_run,
    (select count(*) from public.match_players p where p.match_id=m.id and p.is_goalkeeper_snapshot) as keepers,
    exists (select 1 from public.team_assignments a
      left join public.teams t on (t.group_id,t.match_id,t.id)=(a.group_id,a.match_id,a.team_id)
      left join public.match_players p on (p.group_id,p.match_id,p.player_id)=(a.group_id,a.match_id,a.player_id)
      where a.match_id=m.id and (a.group_id<>m.group_id or t.id is null or p.player_id is null)) as invalid_assignment_link,
    exists (select 1 from public.match_players p where p.match_id=m.id and p.group_id<>m.group_id)
      or exists(select 1 from public.teams t where t.match_id=m.id and t.group_id<>m.group_id)
      or exists(select 1 from public.draw_runs r where r.match_id=m.id and r.group_id<>m.group_id) as invalid_group_link
  from public.matches m where m.status='drawn'
), sizes as (
  select g.id as match_id,t.id as team_id,count(a.id) as size,
    count(a.id) filter(where not a.starts_as_reserve) as starters,
    count(a.id) filter(where p.is_goalkeeper_snapshot) as keepers,
    count(a.id) filter(where p.is_goalkeeper_snapshot and not a.starts_as_reserve) as court_keepers
  from graph g join public.teams t on t.match_id=g.id
  left join public.team_assignments a on a.match_id=g.id and a.team_id=t.id
  left join public.match_players p on p.match_id=a.match_id and p.player_id=a.player_id
  group by g.id,t.id
), inspected as (
  select g.id as match_id,g.group_id,array_remove(array[
    case when g.team_count not in (2,3) or g.players_on_court not between 1 and 20 then 'configuration' end,
    case when g.teams<>g.team_count or g.valid_team_indexes<>g.team_count then 'team_configuration' end,
    case when g.participants<g.team_count or g.not_present<>0 then 'participants' end,
    case when g.assignments<>g.participants or g.assigned_players<>g.participants
      or g.invalid_assignment_link then 'assignment_coverage' end,
    case when g.invalid_group_link then 'group_isolation' end,
    case when g.runs=0 or g.distinct_runs<>g.runs or g.first_run<>1 or g.last_run<>g.runs then 'run_sequence' end,
    case when g.accepted<>1 or g.accepted_run is distinct from g.last_run then 'accepted_run' end,
    case when exists(select 1 from sizes s where s.match_id=g.id and
      (s.size=0 or s.starters<>least(g.players_on_court,s.size)
       or (s.keepers>0 and s.court_keepers=0))) then 'starters_reserves_goalkeepers' end,
    case when (select max(s.size)-min(s.size) from sizes s where s.match_id=g.id)>1 then 'team_sizes' end,
    case when (select count(*) from sizes s where s.match_id=g.id and s.court_keepers>0)
      <least(g.team_count,g.keepers) then 'goalkeeper_coverage' end
  ],null) as violations from graph g
)
select match_id,group_id,violations from inspected where cardinality(violations)>0 order by group_id,match_id;
