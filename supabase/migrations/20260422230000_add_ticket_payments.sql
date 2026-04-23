-- Cash payment capture for the lightweight POS flow.
-- Schema is payment-method-agnostic so card/edahabia/other can
-- be added later without another migration. Totals are derived
-- from ticket_items at payment time — we don't snapshot them
-- here (the items themselves already snapshot name/price).

CREATE TABLE ticket_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'cash',
  amount NUMERIC(10, 2) NOT NULL,
  tendered NUMERIC(10, 2),
  change_given NUMERIC(10, 2),
  note TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_by UUID REFERENCES staff(id) ON DELETE SET NULL
);

CREATE INDEX idx_ticket_payments_ticket ON ticket_payments(ticket_id);
CREATE INDEX idx_ticket_payments_org_date ON ticket_payments(organization_id, paid_at DESC);

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS payment_status TEXT;

ALTER TABLE ticket_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view org payments"
  ON ticket_payments FOR SELECT
  USING (organization_id = get_my_org_id());

CREATE POLICY "Staff can manage org payments"
  ON ticket_payments FOR ALL
  USING (organization_id = get_my_org_id())
  WITH CHECK (organization_id = get_my_org_id());
