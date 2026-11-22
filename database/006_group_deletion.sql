-- A group cascades to players and matches; matches cascade to participants.
-- The default stays immediate. Only DELETE /groups/:id defers the participant
-- -> player check until both branches of the cascade have finished.
begin;
set local lock_timeout = '5s';
alter table public.match_players
  alter constraint match_players_player_fk deferrable initially immediate;
commit;
