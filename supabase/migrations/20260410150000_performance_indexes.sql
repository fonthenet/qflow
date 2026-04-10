-- ============================================================
-- Performance indexes for common query patterns
-- ============================================================

-- tickets: department + status (used by display queries, queue filtering)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_dept_status
  ON tickets(department_id, status);

-- departments: office + active filter (used by kiosk-info, display)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_departments_office_active
  ON departments(office_id) WHERE is_active = true;

-- services: department + active filter (used by kiosk-info, booking)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_services_dept_active
  ON services(department_id) WHERE is_active = true;

-- appointments: office + status (used by slot availability, display)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_office_status
  ON appointments(office_id, status);

-- audit_logs: created_at for range queries and retention cleanup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_created
  ON audit_logs(created_at);

-- whatsapp_sessions: organization + state (used by session lookup)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_sessions_org_state
  ON whatsapp_sessions(organization_id, state);
