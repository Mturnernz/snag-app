-- The leaderboard/points feature was scaffolded (tables + get_leaderboard +
-- award_points) but nothing ever called award_points — no trigger, no other
-- RPC, no client code — so points_log/user_points stayed empty and the
-- leaderboard never populated. The client-side leaderboard has been removed;
-- these are now fully orphaned (nothing else references them).

drop function if exists public.get_leaderboard(uuid, timestamptz);
drop function if exists public.award_points(text, int, uuid);
drop table if exists public.points_log;
drop table if exists public.user_points;
