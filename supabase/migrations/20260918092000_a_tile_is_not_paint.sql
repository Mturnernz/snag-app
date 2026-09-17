-- A tile is not paint.
--
-- Tiles behave like paint and not like an appliance: the colour is the headline,
-- there are several in one room, and the only thing telling two apart is where
-- each went. Squeezing them into `finish` would have worked and would have put
-- "Paint" above a tile code on the one page whose whole job is to be believed in
-- a shop eight months later.
--
-- **This value is added alone, in its own file, and that is not tidiness.**
-- Postgres will not let a new enum value be used in the same transaction that
-- added it, and a migration runs in one — so a file that both adds `tile` and
-- refers to it fails whole. Nothing else belongs here.

alter type home.thing_kind add value if not exists 'tile';

notify pgrst, 'reload schema';
