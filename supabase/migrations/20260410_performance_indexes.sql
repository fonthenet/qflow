-- Performance indexes for common query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tickets_dept_status ON tickets(department_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_departments_office_active ON departments(office_id, is_active);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_services_dept_active ON services(department_id, is_active);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
