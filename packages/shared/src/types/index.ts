import type { TicketStatus, DeskStatus, StaffRole } from '../constants';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Office {
  id: string;
  organization_id: string;
  name: string;
  address: string | null;
  timezone: string;
  is_active: boolean;
  operating_hours: Record<string, { open: string; close: string }> | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: string;
  office_id: string;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface Service {
  id: string;
  department_id: string;
  name: string;
  code: string;
  description: string | null;
  estimated_service_time: number;
  is_active: boolean;
  priority: number;
  sort_order: number;
  created_at: string;
}

export interface Desk {
  id: string;
  office_id: string;
  department_id: string;
  name: string;
  display_name: string | null;
  is_active: boolean;
  current_staff_id: string | null;
  status: DeskStatus;
  created_at: string;
}

export interface Staff {
  id: string;
  auth_user_id: string;
  organization_id: string;
  office_id: string | null;
  department_id: string | null;
  full_name: string;
  email: string;
  role: StaffRole;
  is_active: boolean;
  created_at: string;
}

export interface Ticket {
  id: string;
  office_id: string;
  department_id: string;
  service_id: string;
  ticket_number: string;
  daily_sequence: number;
  status: TicketStatus;
  priority: number;
  customer_data: Record<string, unknown> | null;
  qr_token: string;
  desk_id: string | null;
  called_by_staff_id: string | null;
  called_at: string | null;
  serving_started_at: string | null;
  completed_at: string | null;
  estimated_wait_minutes: number | null;
  transferred_from_ticket_id: string | null;
  group_id: string | null;
  priority_category_id: string | null;
  customer_id: string | null;
  appointment_id: string | null;
  is_remote: boolean;
  checked_in_at: string | null;
  notes: string | null;
  parked_at: string | null;
  created_at: string;
}

export interface TicketEvent {
  id: string;
  ticket_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  staff_id: string | null;
  desk_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface IntakeFormField {
  id: string;
  service_id: string;
  field_name: string;
  field_label: string;
  field_type: 'text' | 'textarea' | 'phone' | 'email' | 'select' | 'checkbox' | 'date';
  is_required: boolean;
  options: string[] | null;
  sort_order: number;
  created_at: string;
}

export interface DisplayScreen {
  id: string;
  office_id: string;
  name: string;
  screen_token: string;
  layout: string;
  settings: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

export interface PriorityCategory {
  id: string;
  organization_id: string;
  name: string;
  icon: string | null;
  color: string;
  weight: number;
  is_active: boolean;
  created_at: string;
}

export interface Customer {
  id: string;
  organization_id: string;
  phone: string;
  name: string | null;
  email: string | null;
  visit_count: number;
  last_visit_at: string | null;
  created_at: string;
}

export type AppointmentStatus = 'pending' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'no_show' | 'declined';

export interface Appointment {
  id: string;
  office_id: string;
  department_id: string;
  service_id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  scheduled_at: string;
  status: AppointmentStatus;
  ticket_id: string | null;
  notes: string | null;
  staff_id: string | null;
  locale: string | null;
  recurrence_rule: string | null;
  recurrence_parent_id: string | null;
  reminder_sent: boolean;
  calendar_token: string | null;
  source: string | null;
  created_at: string;
}

/** Appointment with joined relations for calendar display */
export interface CalendarAppointment extends Appointment {
  service?: { name: string; color?: string | null; estimated_service_time: number } | null;
  department?: { name: string; code: string } | null;
  staff?: { full_name: string } | null;
  wilaya?: string | null;
}

export interface Feedback {
  id: string;
  ticket_id: string;
  staff_id: string | null;
  service_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface VirtualQueueCode {
  id: string;
  organization_id: string;
  office_id: string | null;
  department_id: string | null;
  service_id: string | null;
  qr_token: string;
  is_active: boolean;
  created_at: string;
}

export * from './platform';
