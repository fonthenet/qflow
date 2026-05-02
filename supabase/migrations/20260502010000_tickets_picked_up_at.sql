-- Rider pickup timestamp — the moment the rider has the order in
-- hand and is leaving the restaurant. Distinct from dispatched_at
-- (rider accepted the run, may still be heading to the restaurant)
-- and arrived_at (rider has reached the customer).
--
-- Lifecycle for a delivery ticket:
--   created       — operator/customer placed the order
--   dispatched_at — rider accepted; en route to restaurant
--   picked_up_at  — rider has the food; en route to customer  ← NEW
--   arrived_at    — rider is at the customer's door
--   delivered_at  — order handed over
--
-- The new stage matches what DoorDash / Uber Eats drivers see:
-- "go to restaurant" then "go to customer", with explicit handoff
-- at pickup. Lets the customer's tracking page surface a more
-- accurate "your driver picked up your order" event, and lets the
-- rider's live GPS only stream the post-pickup leg if we want
-- (we still stream both legs today; this just adds the pivot).

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS picked_up_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tickets_picked_up_at
  ON public.tickets (picked_up_at) WHERE picked_up_at IS NOT NULL;
