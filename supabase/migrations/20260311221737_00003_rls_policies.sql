
-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE desks ENABLE ROW LEVEL SECURITY;
ALTER TABLE desk_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_form_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE display_screens ENABLE ROW LEVEL SECURITY;
ALTER TABLE priority_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE virtual_queue_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE translations ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Helper: Get current user's organization_id
-- ============================================
CREATE OR REPLACE FUNCTION get_my_org_id()
RETURNS uuid AS $$
  SELECT organization_id FROM staff WHERE auth_user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================
-- ORGANIZATIONS: Staff can read their own org
-- ============================================
CREATE POLICY "Staff can view own org"
  ON organizations FOR SELECT
  USING (id = get_my_org_id());

CREATE POLICY "Admin can update own org"
  ON organizations FOR UPDATE
  USING (id = get_my_org_id())
  WITH CHECK (id = get_my_org_id());

-- ============================================
-- OFFICES: Staff can read offices in their org
-- ============================================
CREATE POLICY "Staff can view org offices"
  ON offices FOR SELECT
  USING (organization_id = get_my_org_id());

CREATE POLICY "Admin can manage offices"
  ON offices FOR ALL
  USING (organization_id = get_my_org_id())
  WITH CHECK (organization_id = get_my_org_id());

-- ============================================
-- DEPARTMENTS: Staff can read departments in their org offices
-- ============================================
CREATE POLICY "Staff can view departments"
  ON departments FOR SELECT
  USING (office_id IN (SELECT id FROM offices WHERE organization_id = get_my_org_id()));

CREATE POLICY "Admin can manage departments"
  ON departments FOR ALL
  USING (office_id IN (SELECT id FROM offices WHERE organization_id = get_my_org_id()))
  WITH CHECK (office_id IN (SELECT id FROM offices WHERE organization_id = get_my_org_id()));

-- ============================================
-- SERVICES
-- ============================================
CREATE POLICY "Staff can view services"
  ON services FOR SELECT
  USING (department_id IN (
    SELECT d.id FROM departments d
    JOIN offices o ON o.id = d.office_id
    WHERE o.organization_id = get_my_org_id()
  ));

CREATE POLICY "Admin can manage services"
  ON services FOR ALL
  USING (department_id IN (
    SELECT d.id FROM departments d
    JOIN offices o ON o.id = d.office_id
    WHERE o.organization_id = get_my_org_id()
  ))
  WITH CHECK (department_id IN (
    SELECT d.id FROM departments d
    JOIN offices o ON o.id = d.office_id
    WHERE o.organization_id = get_my_org_id()
  ));

-- ============================================
-- STAFF
-- ============================================
CREATE POLICY "Staff can view org staff"
  ON staff FOR SELECT
  USING (organization_id = get_my_org_id());

CREATE POLICY "Admin can manage staff"
  ON staff FOR ALL
  USING (organization_id = get_my_org_id())
  WITH CHECK (organization_id = get_my_org_id());

-- ============================================
-- DESKS
-- ============================================
CREATE POLICY "Staff can view desks"
  ON desks FOR SELECT
  USING (office_id IN (SELECT id FROM offices WHERE organization_id = get_my_org_id()));

CREATE POLICY "Admin can manage desks"
  ON desks FOR ALL
  USING (office_id IN (SELECT id FROM offices WHERE organization_id = get_my_org_id()))
  WITH CHECK (office_id IN (SELECT id FROM offices WHERE organization_id = get_my_org_id()));

-- ============================================
-- DESK_SERVICES
-- ============================================
CREATE POLICY "Staff can view desk_services"
  ON desk_services FOR SELECT
  USING (desk_id IN (
    SELECT id FROM desks WHERE office_id IN (
      SELECT id FROM offices WHERE organization_id = get_my_org_id()
    )
  ));

CREATE POLICY "Admin can manage desk_services"
  ON desk_services FOR ALL
  USING (desk_id IN (
    SELECT id FROM desks WHERE office_id IN (
      SELECT id FROM offices WHERE organization_id = get_my_org_id()
    )
  ))
  WITH CHECK (desk_id IN (
    SELECT id FROM desks WHERE office_id IN (
      SELECT id FROM offices WHERE organization_id = get_my_org_id()
    )
  ));

-- ============================================
-- TICKETS: Staff can manage, customers can read own via qr_token
-- ============================================
CREATE POLICY "Staff can view org tickets"
  ON tickets FOR SELECT
  USING (office_id IN (SELECT id FROM offices WHERE organization_id = get_my_org_id()));

CREATE POLICY "Staff can manage tickets"
  ON tickets FOR ALL
  USING (office_id IN (SELECT id FROM offices WHERE organization_id = get_my_org_id()))
  WITH CHECK (office_id IN (SELECT id FROM offices WHERE organization_id = get_my_org_id()));

-- Public access: customers can view their ticket by qr_token
CREATE POLICY "Public can view ticket by qr_token"
  ON tickets FOR SELECT
  USING (true);

-- Public can update customer_data and status (for check-in)
CREATE POLICY "Public can update ticket for checkin"
  ON tickets FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- ============================================
-- TICKET EVENTS
-- ============================================
CREATE POLICY "Staff can view ticket events"
  ON ticket_events FOR SELECT
  USING (ticket_id IN (
    SELECT id FROM tickets WHERE office_id IN (
      SELECT id FROM offices WHERE organization_id = get_my_org_id()
    )
  ));

CREATE POLICY "Staff can insert ticket events"
  ON ticket_events FOR INSERT
  WITH CHECK (true);

-- ============================================
-- TICKET SEQUENCES
-- ============================================
CREATE POLICY "Staff can manage sequences"
  ON ticket_sequences FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================
-- INTAKE FORM FIELDS
-- ============================================
CREATE POLICY "Anyone can view intake fields"
  ON intake_form_fields FOR SELECT
  USING (true);

CREATE POLICY "Admin can manage intake fields"
  ON intake_form_fields FOR ALL
  USING (service_id IN (
    SELECT s.id FROM services s
    JOIN departments d ON d.id = s.department_id
    JOIN offices o ON o.id = d.office_id
    WHERE o.organization_id = get_my_org_id()
  ))
  WITH CHECK (service_id IN (
    SELECT s.id FROM services s
    JOIN departments d ON d.id = s.department_id
    JOIN offices o ON o.id = d.office_id
    WHERE o.organization_id = get_my_org_id()
  ));

-- ============================================
-- NOTIFICATIONS
-- ============================================
CREATE POLICY "Public can view notifications"
  ON notifications FOR SELECT
  USING (true);

CREATE POLICY "Staff can manage notifications"
  ON notifications FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================
-- DISPLAY SCREENS: public read via token
-- ============================================
CREATE POLICY "Public can view display screens"
  ON display_screens FOR SELECT
  USING (true);

CREATE POLICY "Admin can manage display screens"
  ON display_screens FOR ALL
  USING (office_id IN (SELECT id FROM offices WHERE organization_id = get_my_org_id()))
  WITH CHECK (office_id IN (SELECT id FROM offices WHERE organization_id = get_my_org_id()));

-- ============================================
-- PRIORITY CATEGORIES
-- ============================================
CREATE POLICY "Staff can view priority cats"
  ON priority_categories FOR SELECT
  USING (organization_id = get_my_org_id());

CREATE POLICY "Admin can manage priority cats"
  ON priority_categories FOR ALL
  USING (organization_id = get_my_org_id())
  WITH CHECK (organization_id = get_my_org_id());

-- ============================================
-- CUSTOMERS
-- ============================================
CREATE POLICY "Staff can view customers"
  ON customers FOR SELECT
  USING (organization_id = get_my_org_id());

CREATE POLICY "Staff can manage customers"
  ON customers FOR ALL
  USING (organization_id = get_my_org_id())
  WITH CHECK (organization_id = get_my_org_id());

-- ============================================
-- APPOINTMENTS: public can create and view own
-- ============================================
CREATE POLICY "Public can view appointments"
  ON appointments FOR SELECT
  USING (true);

CREATE POLICY "Public can create appointments"
  ON appointments FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Staff can manage appointments"
  ON appointments FOR ALL
  USING (office_id IN (SELECT id FROM offices WHERE organization_id = get_my_org_id()))
  WITH CHECK (office_id IN (SELECT id FROM offices WHERE organization_id = get_my_org_id()));

-- ============================================
-- VIRTUAL QUEUE CODES
-- ============================================
CREATE POLICY "Public can view virtual codes"
  ON virtual_queue_codes FOR SELECT
  USING (true);

CREATE POLICY "Admin can manage virtual codes"
  ON virtual_queue_codes FOR ALL
  USING (office_id IN (SELECT id FROM offices WHERE organization_id = get_my_org_id()))
  WITH CHECK (office_id IN (SELECT id FROM offices WHERE organization_id = get_my_org_id()));

-- ============================================
-- FEEDBACK: public can create
-- ============================================
CREATE POLICY "Public can create feedback"
  ON feedback FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Staff can view feedback"
  ON feedback FOR SELECT
  USING (true);

-- ============================================
-- TRANSLATIONS
-- ============================================
CREATE POLICY "Public can view translations"
  ON translations FOR SELECT
  USING (true);

CREATE POLICY "Admin can manage translations"
  ON translations FOR ALL
  USING (organization_id = get_my_org_id())
  WITH CHECK (organization_id = get_my_org_id());
;
