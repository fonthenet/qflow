-- Add updated_at column to appointments table
-- Used by the activity feed to detect recently modified appointments
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Back-fill: set updated_at = created_at for existing rows
UPDATE appointments SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = created_at;

-- Auto-update trigger (reuses existing update_updated_at function)
CREATE TRIGGER tr_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
