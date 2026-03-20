-- Office holidays / closure dates
-- Allows admins to mark specific dates as closed (full-day or partial override).

CREATE TABLE IF NOT EXISTS office_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name text NOT NULL DEFAULT 'Holiday',
  is_full_day boolean DEFAULT true,
  open_time time,      -- for partial-day overrides (e.g. half-day)
  close_time time,     -- for partial-day overrides
  created_by uuid REFERENCES staff(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(office_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS idx_office_holidays_office ON office_holidays(office_id, holiday_date);

-- RLS
ALTER TABLE office_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read office holidays" ON office_holidays
  FOR SELECT USING (
    office_id IN (
      SELECT o.id FROM offices o
      INNER JOIN staff s ON s.organization_id = o.organization_id
      WHERE s.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage office holidays" ON office_holidays
  FOR ALL USING (
    office_id IN (
      SELECT o.id FROM offices o
      INNER JOIN staff s ON s.organization_id = o.organization_id
      WHERE s.auth_user_id = auth.uid() AND s.role IN ('admin', 'manager')
    )
  );
