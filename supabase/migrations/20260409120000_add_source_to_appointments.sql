-- Add source column to appointments table
-- Tracks where the appointment was created from: whatsapp, messenger, web, portal, etc.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'source'
  ) THEN
    ALTER TABLE appointments ADD COLUMN source text DEFAULT NULL;
    COMMENT ON COLUMN appointments.source IS 'Origin of the appointment: whatsapp, messenger, web, portal, in_house';
  END IF;
END $$;
