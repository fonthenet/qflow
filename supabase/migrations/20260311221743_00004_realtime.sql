
-- Enable realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE desks;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
;
