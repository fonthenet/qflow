
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- ORGANIZATIONS
-- ============================================
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  logo_url text,
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================
-- OFFICES
-- ============================================
CREATE TABLE offices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  timezone text DEFAULT 'UTC',
  is_active boolean DEFAULT true,
  operating_hours jsonb,
  settings jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_offices_org ON offices(organization_id);

-- ============================================
-- DEPARTMENTS
-- ============================================
CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(office_id, code)
);

CREATE INDEX idx_departments_office ON departments(office_id);

-- ============================================
-- SERVICES
-- ============================================
CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  description text,
  estimated_service_time integer DEFAULT 10,
  is_active boolean DEFAULT true,
  priority integer DEFAULT 0,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(department_id, code)
);

CREATE INDEX idx_services_dept ON services(department_id);

-- ============================================
-- STAFF
-- ============================================
CREATE TABLE staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  office_id uuid REFERENCES offices(id) ON DELETE SET NULL,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'manager', 'desk_operator')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_staff_org ON staff(organization_id);
CREATE INDEX idx_staff_office ON staff(office_id);
CREATE INDEX idx_staff_auth ON staff(auth_user_id);

-- ============================================
-- DESKS
-- ============================================
CREATE TABLE desks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name text NOT NULL,
  display_name text,
  is_active boolean DEFAULT true,
  current_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  status text DEFAULT 'closed' CHECK (status IN ('open', 'closed', 'on_break')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_desks_office ON desks(office_id);
CREATE INDEX idx_desks_dept ON desks(department_id);

-- ============================================
-- DESK_SERVICES (M2M)
-- ============================================
CREATE TABLE desk_services (
  desk_id uuid NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (desk_id, service_id)
);

-- ============================================
-- PRIORITY CATEGORIES
-- ============================================
CREATE TABLE priority_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  icon text,
  color text DEFAULT '#6366f1',
  weight integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_priority_cats_org ON priority_categories(organization_id);

-- ============================================
-- CUSTOMERS (optional registration)
-- ============================================
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone text NOT NULL,
  name text,
  email text,
  visit_count integer DEFAULT 0,
  last_visit_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, phone)
);

CREATE INDEX idx_customers_org ON customers(organization_id);

-- ============================================
-- APPOINTMENTS
-- ============================================
CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  customer_phone text,
  customer_email text,
  scheduled_at timestamptz NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'checked_in', 'completed', 'cancelled')),
  ticket_id uuid,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_appointments_office ON appointments(office_id, scheduled_at);

-- ============================================
-- TICKET SEQUENCES
-- ============================================
CREATE TABLE ticket_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  seq_date date NOT NULL DEFAULT CURRENT_DATE,
  last_sequence integer DEFAULT 0,
  UNIQUE(department_id, seq_date)
);

-- ============================================
-- TICKETS
-- ============================================
CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  ticket_number text NOT NULL,
  daily_sequence integer NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'waiting', 'called', 'serving', 'served', 'no_show', 'cancelled', 'transferred')),
  priority integer DEFAULT 0,
  customer_data jsonb,
  qr_token text UNIQUE NOT NULL,
  desk_id uuid REFERENCES desks(id) ON DELETE SET NULL,
  called_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  called_at timestamptz,
  serving_started_at timestamptz,
  completed_at timestamptz,
  estimated_wait_minutes integer,
  transferred_from_ticket_id uuid REFERENCES tickets(id),
  group_id uuid,
  priority_category_id uuid REFERENCES priority_categories(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
  is_remote boolean DEFAULT false,
  checked_in_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_tickets_office_status ON tickets(office_id, status, created_at);
CREATE INDEX idx_tickets_dept_status ON tickets(department_id, status, created_at);
CREATE INDEX idx_tickets_qr ON tickets(qr_token);
CREATE INDEX idx_tickets_group ON tickets(group_id) WHERE group_id IS NOT NULL;

-- Add FK for appointment -> ticket
ALTER TABLE appointments ADD CONSTRAINT fk_appointment_ticket
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;

-- ============================================
-- TICKET EVENTS (audit log)
-- ============================================
CREATE TABLE ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  desk_id uuid REFERENCES desks(id) ON DELETE SET NULL,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_ticket_events_ticket ON ticket_events(ticket_id, created_at);

-- ============================================
-- INTAKE FORM FIELDS
-- ============================================
CREATE TABLE intake_form_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  field_label text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN ('text', 'textarea', 'phone', 'email', 'select', 'checkbox', 'date')),
  is_required boolean DEFAULT false,
  options jsonb,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_intake_fields_service ON intake_form_fields(service_id, sort_order);

-- ============================================
-- NOTIFICATIONS
-- ============================================
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  type text NOT NULL,
  channel text DEFAULT 'web',
  payload jsonb,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_notifications_ticket ON notifications(ticket_id);

-- ============================================
-- DISPLAY SCREENS
-- ============================================
CREATE TABLE display_screens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  name text NOT NULL,
  screen_token text UNIQUE NOT NULL,
  layout text DEFAULT 'standard',
  settings jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_display_screens_office ON display_screens(office_id);

-- ============================================
-- VIRTUAL QUEUE CODES
-- ============================================
CREATE TABLE virtual_queue_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id uuid NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  service_id uuid REFERENCES services(id) ON DELETE SET NULL,
  qr_token text UNIQUE NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ============================================
-- FEEDBACK
-- ============================================
CREATE TABLE feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_feedback_ticket ON feedback(ticket_id);
CREATE INDEX idx_feedback_staff ON feedback(staff_id);

-- ============================================
-- TRANSLATIONS
-- ============================================
CREATE TABLE translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  locale text NOT NULL,
  value text NOT NULL,
  UNIQUE(organization_id, key, locale)
);

CREATE INDEX idx_translations_org ON translations(organization_id, locale);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_offices_updated_at
  BEFORE UPDATE ON offices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
;
