-- The earlier riders migration intended to repoint tickets.assigned_rider_id
-- away from staff(id) (the legacy "rider = staff member" model) onto the new
-- lightweight public.riders table. That FK swap never landed in production,
-- so /api/orders/assign would 500 with
--    'tickets_assigned_rider_id_fkey violates foreign key constraint'
-- on every assignment. This migration is the corrective step.
--
-- Idempotent: dropping IF EXISTS, scrubbing orphan refs first, then
-- recreating the FK against riders(id) ON DELETE SET NULL so historical
-- tickets keep their lifecycle if a rider is deleted.

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_assigned_rider_id_fkey;

-- Any in-flight rows still pointing at staff ids that don't exist in riders
-- must be cleared, otherwise the new FK creation would fail.
UPDATE public.tickets
   SET assigned_rider_id = NULL
 WHERE assigned_rider_id IS NOT NULL
   AND assigned_rider_id NOT IN (SELECT id FROM public.riders);

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_assigned_rider_id_fkey
  FOREIGN KEY (assigned_rider_id)
  REFERENCES public.riders(id)
  ON DELETE SET NULL;
