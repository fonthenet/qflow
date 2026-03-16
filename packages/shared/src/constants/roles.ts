export const STAFF_ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  BRANCH_ADMIN: 'branch_admin',
  DESK_OPERATOR: 'desk_operator',
  RECEPTIONIST: 'receptionist',
  FLOOR_MANAGER: 'floor_manager',
  ANALYST: 'analyst',
  AGENT: 'agent',
} as const;

export type StaffRole = (typeof STAFF_ROLES)[keyof typeof STAFF_ROLES];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  [STAFF_ROLES.ADMIN]: 'Admin',
  [STAFF_ROLES.MANAGER]: 'Manager',
  [STAFF_ROLES.BRANCH_ADMIN]: 'Branch Admin',
  [STAFF_ROLES.DESK_OPERATOR]: 'Desk Operator',
  [STAFF_ROLES.RECEPTIONIST]: 'Receptionist / Check-In',
  [STAFF_ROLES.FLOOR_MANAGER]: 'Floor Manager',
  [STAFF_ROLES.ANALYST]: 'Analyst',
  [STAFF_ROLES.AGENT]: 'Agent',
};

export const ADMIN_LIKE_ROLES: StaffRole[] = [
  STAFF_ROLES.ADMIN,
  STAFF_ROLES.MANAGER,
  STAFF_ROLES.BRANCH_ADMIN,
];

export const DESK_STATUSES = {
  OPEN: 'open',
  CLOSED: 'closed',
  ON_BREAK: 'on_break',
} as const;

export type DeskStatus = (typeof DESK_STATUSES)[keyof typeof DESK_STATUSES];
