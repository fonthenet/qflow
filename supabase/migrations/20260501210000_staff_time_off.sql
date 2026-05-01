-- Per-stylist time off — vacations, sick days, ad-hoc blockers.
-- Distinct from the recurring weekly work_schedule (which says
-- "Marie works Tue/Thu") and from availability_status (which is
-- the live "on floor / on break / off" toggle that flips many times
-- a day). Time-off rows are date-bounded ranges the operator sets
-- ahead of time and the slot generator respects.
--
-- Stored as half-open intervals [starts_at, ends_at) so a single
-- row can cover "all day Friday" without overlapping into Saturday.

CREATE TABLE IF NOT EXISTS public.staff_time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_time_off_valid_range CHECK (ends_at > starts_at)
);

COMMENT ON TABLE public.staff_time_off IS
  'Per-stylist time-off ranges (vacation / sick / blocker). Slot generator excludes the stylist from capacity for any slot inside an active range.';

CREATE INDEX IF NOT EXISTS staff_time_off_staff_idx
  ON public.staff_time_off(staff_id, starts_at, ends_at);

ALTER TABLE public.staff_time_off ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage own org time_off" ON public.staff_time_off;
CREATE POLICY "Staff manage own org time_off"
  ON public.staff_time_off
  USING (
    staff_id IN (SELECT id FROM public.staff WHERE organization_id = public.get_my_org_id())
  )
  WITH CHECK (
    staff_id IN (SELECT id FROM public.staff WHERE organization_id = public.get_my_org_id())
  );

DROP POLICY IF EXISTS "Service role full access time_off" ON public.staff_time_off;
CREATE POLICY "Service role full access time_off"
  ON public.staff_time_off
  AS PERMISSIVE FOR ALL
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_staff_time_off_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS staff_time_off_touch_updated_at ON public.staff_time_off;
CREATE TRIGGER staff_time_off_touch_updated_at
  BEFORE UPDATE ON public.staff_time_off
  FOR EACH ROW EXECUTE FUNCTION public.touch_staff_time_off_updated_at();
