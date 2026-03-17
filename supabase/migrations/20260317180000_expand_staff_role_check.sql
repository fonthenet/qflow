-- Expand the staff role CHECK constraint to include all application-defined roles.
-- The original constraint only allowed: admin, manager, desk_operator.
-- New roles added: branch_admin, receptionist, floor_manager, analyst, agent.

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;

ALTER TABLE staff ADD CONSTRAINT staff_role_check
  CHECK (role IN (
    'admin',
    'manager',
    'branch_admin',
    'desk_operator',
    'receptionist',
    'floor_manager',
    'analyst',
    'agent'
  ));
