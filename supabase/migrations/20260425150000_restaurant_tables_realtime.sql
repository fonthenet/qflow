-- Add restaurant_tables to the realtime publication so the Kitchen
-- Display System on Expo + Station picks up table reassignments
-- (server moves a seated ticket from Table 1 to Table 3) without
-- waiting for the 8 s poll fallback. The KDS card label depends on
-- restaurant_tables.label, so a stale subscription means the card
-- shows the wrong table until the next poll.
ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurant_tables;
