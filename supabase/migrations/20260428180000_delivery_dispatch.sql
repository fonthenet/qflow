-- Delivery dispatch + rider role + rider phone.
--
-- Closes the delivery loop: operator (or future rider portal) marks a
-- serving ticket as dispatched (out for delivery) and then delivered.
-- Customer gets a WhatsApp message at each transition.
--
-- Schema additions:
--   tickets.assigned_rider_id  → FK staff(id), set when operator assigns
--   tickets.dispatched_at      → set on POST /api/orders/dispatch
--   tickets.delivered_at       → set on POST /api/orders/delivered
--                                (also flips status to 'served')
--   staff.role                 → 'rider' added to allowed values
--   staff.phone                → callable for the operator + on-WhatsApp
--                                "out for delivery" message body
--
-- Index supports the rider portal's "show MY deliveries" query without
-- a sequential scan on tickets.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS assigned_rider_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tickets_assigned_rider_active
  ON tickets(assigned_rider_id)
  WHERE assigned_rider_id IS NOT NULL AND delivered_at IS NULL;

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check CHECK (role = ANY (ARRAY[
  'admin'::text, 'manager'::text, 'branch_admin'::text,
  'desk_operator'::text, 'receptionist'::text,
  'floor_manager'::text, 'analyst'::text, 'agent'::text,
  'rider'::text
]));

ALTER TABLE staff ADD COLUMN IF NOT EXISTS phone TEXT;
