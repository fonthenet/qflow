export const STAFF_ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  DESK_OPERATOR: 'desk_operator',
} as const;

export type StaffRole = (typeof STAFF_ROLES)[keyof typeof STAFF_ROLES];

export const DESK_STATUSES = {
  OPEN: 'open',
  CLOSED: 'closed',
  ON_BREAK: 'on_break',
} as const;

export type DeskStatus = (typeof DESK_STATUSES)[keyof typeof DESK_STATUSES];
