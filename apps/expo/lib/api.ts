import { API_BASE_URL as BASE_URL } from './config';

export interface TicketResponse {
  id: string;
  qr_token: string;
  ticket_number: string;
  status: string;
  office_id: string;
  department_id: string;
  service_id: string | null;
  desk_id: string | null;
  customer_data: { name?: string; phone?: string; email?: string } | null;
  is_remote: boolean | null;
  priority_category_id: string | null;
  called_at: string | null;
  serving_started_at: string | null;
  completed_at: string | null;
  updated_at?: string;
  estimated_wait_minutes: number | null;
  recall_count: number;
  created_at: string;
  office: {
    id: string;
    name: string;
    organization_id: string;
    timezone?: string | null;
  } | null;
  department: {
    id: string;
    name: string;
    code: string;
  } | null;
  service: {
    id: string;
    name: string;
    code: string;
  } | null;
  desk: {
    id: string;
    name: string;
  } | null;
  position: number | null;
  now_serving: string | null;
}

export async function fetchTicket(token: string): Promise<TicketResponse | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/app-clip-ticket?token=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data as TicketResponse;
  } catch {
    return null;
  }
}

export async function registerApns(params: {
  ticketId: string;
  deviceToken: string;
  kind?: 'alert' | 'liveactivity';
  environment?: string;
  bundleId?: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/apns-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketId: params.ticketId,
        deviceToken: params.deviceToken,
        kind: params.kind ?? 'alert',
        environment: params.environment ?? 'production',
        bundleId: params.bundleId ?? 'com.qflo.app',
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function registerAndroid(params: {
  ticketId?: string;
  qrToken?: string;
  deviceToken: string;
  packageName?: string;
}): Promise<{ ok: boolean; ticketId?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/android-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketId: params.ticketId,
        qrToken: params.qrToken,
        deviceToken: params.deviceToken,
        packageName: params.packageName ?? 'com.qflo.app',
      }),
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return { ok: true, ticketId: data.ticketId };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Join flow types & API
// ---------------------------------------------------------------------------

export interface JoinInfoResponse {
  virtualCode: {
    id: string;
    office_id: string | null;
    department_id: string | null;
    service_id: string | null;
  };
  organization: {
    id: string;
    name: string;
    logo_url: string | null;
    settings?: Record<string, any>;
  };
  offices: Array<{ id: string; name: string; address: string | null; kiosk_slug?: string | null }>;
  departments: Array<{ id: string; name: string; office_id: string }>;
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    estimated_service_time: number | null;
    department_id: string;
  }>;
  waitingTickets: Array<{
    office_id: string;
    department_id: string;
    service_id: string;
  }>;
}

export async function fetchJoinInfo(token: string): Promise<JoinInfoResponse | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/join-info?token=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    return (await res.json()) as JoinInfoResponse;
  } catch {
    return null;
  }
}

export interface JoinQueueResult {
  ticket: {
    id: string;
    qr_token: string;
    ticket_number: string;
    status: string;
    estimated_wait_minutes: number | null;
  };
}

export async function joinQueue(params: {
  officeId: string;
  departmentId: string;
  serviceId: string;
  customerName?: string;
  customerPhone?: string;
  reason?: string;
  customData?: Record<string, string>;
}): Promise<JoinQueueResult | { error: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/join-queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error ?? 'Failed to join queue' };
    return data as JoinQueueResult;
  } catch {
    return { error: 'Network error. Please try again.' };
  }
}

// ---------------------------------------------------------------------------
// Kiosk flow types & API
// ---------------------------------------------------------------------------

export interface KioskInfoResponse {
  office: {
    id: string;
    name: string;
    address: string | null;
    organization_id: string;
    timezone?: string | null;
    /** Per-day hours keyed monday..sunday. Closed days have `{ open:'', close:'' }` or are absent. */
    operating_hours?: Record<string, { open: string; close: string } | null> | null;
    always_open?: boolean;
    always_closed?: boolean;
  };
  organization: { id: string; name: string; logo_url: string | null };
  departments: Array<{ id: string; name: string; code: string; sort_order: number }>;
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    department_id: string;
    estimated_service_time: number | null;
    sort_order: number;
  }>;
  priorityCategories: Array<{
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
    weight: number;
  }>;
  settings: Record<string, any>;
}

export async function fetchKioskInfo(slug: string): Promise<KioskInfoResponse | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/kiosk-info?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    return (await res.json()) as KioskInfoResponse;
  } catch {
    return null;
  }
}

export interface KioskTicketResult {
  ticket: {
    id: string;
    qr_token: string;
    ticket_number: string;
    status: string;
    estimated_wait_minutes: number | null;
  };
}

export async function createKioskTicket(params: {
  officeId: string;
  departmentId: string;
  serviceId: string;
  priorityCategoryId?: string;
  priority?: number;
  customerName?: string;
  customerPhone?: string;
  customerData?: Record<string, string>;
}): Promise<KioskTicketResult | { error: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/kiosk-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error ?? 'Failed to create ticket' };
    return data as KioskTicketResult;
  } catch {
    return { error: 'Network error. Please try again.' };
  }
}

// ---------------------------------------------------------------------------
// Queue status (peek) — read-only, no ticket required
// ---------------------------------------------------------------------------

export interface QueueStatusResponse {
  office: { id: string; name: string; address: string | null; timezone?: string | null };
  departments: Array<{
    id: string;
    name: string;
    code: string;
    sort_order: number;
    waiting: number;
    called: number;
    serving: number;
    estimatedWaitMinutes: number;
  }>;
  totalWaiting: number;
  totalServing: number;
  bookingMode?: string;
  operatingHours?: Record<string, { open: string; close: string } | null>;
  timezone?: string | null;
  openNow?: boolean;
  todayKey?: string | null;
  alwaysOpen?: boolean;
}

export async function fetchQueueStatus(slug: string): Promise<QueueStatusResponse | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/queue-status?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) return null;
    return (await res.json()) as QueueStatusResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public directory search
// ---------------------------------------------------------------------------
export interface DirectorySearchResult {
  orgId: string;
  orgName: string;
  logoUrl: string | null;
  category: string | null;
  officeId: string;
  officeName: string;
  address: string | null;
  kioskSlug: string;
}

export async function searchDirectory(query: string): Promise<DirectorySearchResult[]> {
  // Abort after 8s so the spinner can never hang indefinitely if the route
  // is unreachable (e.g. older Vercel deploy without /api/directory/search).
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `${BASE_URL}/api/directory/search?q=${encodeURIComponent(query)}`,
      { signal: controller.signal },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: DirectorySearchResult[] };
    return data.results ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Booking / appointment
// ---------------------------------------------------------------------------

export interface BookingSlotsResponse {
  officeId: string;
  date: string;
  slots: string[]; // HH:MM — bookable only (backward-compat)
  /** Full day grid including taken slots. Each entry has an `available` flag. */
  slotsDetailed?: Array<{
    time: string;
    remaining: number;
    total: number;
    available: boolean;
    reason?: 'taken' | 'daily_limit';
  }>;
  meta?: {
    booking_mode: string;
    booking_horizon_days: number;
    slot_duration_minutes: number;
    slots_per_interval: number;
    allow_cancellation: boolean;
  };
}

export async function fetchBookingSlots(
  slug: string,
  serviceId: string,
  date: string // YYYY-MM-DD
): Promise<BookingSlotsResponse | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/booking-slots?slug=${encodeURIComponent(slug)}&serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`
    );
    if (!res.ok) return null;
    return (await res.json()) as BookingSlotsResponse;
  } catch {
    return null;
  }
}

export interface CreateBookingResult {
  appointment: {
    id: string;
    office_id: string;
    department_id: string;
    service_id: string;
    customer_name: string;
    customer_phone: string | null;
    scheduled_at: string;
    status: string;
    /** Per-appointment opaque token used for customer self-service actions. */
    calendar_token: string;
  };
}

export async function createBooking(params: {
  officeId: string;
  departmentId: string;
  serviceId: string;
  customerName: string;
  customerPhone?: string;
  scheduledAt: string; // ISO string
  notes?: string;
  wilaya?: string;
  locale?: 'en' | 'fr' | 'ar';
}): Promise<CreateBookingResult | { error: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/book-appointment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error ?? 'Failed to book appointment' };
    return data as CreateBookingResult;
  } catch {
    return { error: 'Network error. Please try again.' };
  }
}

// ---------------------------------------------------------------------------
// My appointments — customer-scoped via per-appointment calendar_token
// (Reuses platform routes: GET /api/calendar/[token] and POST /api/moderate-appointment.)
// ---------------------------------------------------------------------------

export interface AppointmentDetail {
  id: string;
  status: string;
  scheduled_at: string;
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  calendar_token: string;
  office_id: string;
  department_id: string;
  service_id: string;
  business_name: string | null;
  office_name: string | null;
  office_timezone?: string | null;
  service_name: string | null;
  department_name: string | null;
}

/** The ticket created when a booking is checked in by staff. Mobile uses this
 *  so the Queue tab can auto-switch to the live-tracking view once check-in
 *  happens, without the customer having to scan anything. */
export interface AppointmentLinkedTicket {
  id: string;
  qr_token: string;
  ticket_number: string;
  status: string;
  called_at: string | null;
  completed_at: string | null;
}

/** Fetch the latest state for one booking via the reusable calendar token endpoint. */
export async function fetchAppointmentByToken(calendarToken: string): Promise<AppointmentDetail | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/calendar/${encodeURIComponent(calendarToken)}?format=json`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.appointment as AppointmentDetail) ?? null;
  } catch {
    return null;
  }
}

/** Fetch the appointment *with* its linked live ticket (if any). Used by the
 *  Queue tab's auto-recover effect: when an appointment has been checked in,
 *  the server returns the linked ticket's qr_token so we can promote it to
 *  the active live view. */
export async function fetchAppointmentWithTicket(calendarToken: string): Promise<{
  appointment: AppointmentDetail | null;
  ticket: AppointmentLinkedTicket | null;
}> {
  try {
    const res = await fetch(
      `${BASE_URL}/api/calendar/${encodeURIComponent(calendarToken)}?format=json`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return { appointment: null, ticket: null };
    const data = await res.json();
    return {
      appointment: (data?.appointment as AppointmentDetail) ?? null,
      ticket: (data?.ticket as AppointmentLinkedTicket) ?? null,
    };
  } catch {
    return { appointment: null, ticket: null };
  }
}

/** Cancel a booking using the customer-owned calendar token (no Bearer). */
export async function cancelAppointment(
  calendarToken: string,
  reason?: string,
): Promise<{ ok: true; status: string } | { error: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/moderate-appointment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarToken, action: 'cancel', reason }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data?.error ?? 'Failed to cancel' };
    return { ok: true, status: data?.status ?? 'cancelled' };
  } catch {
    return { error: 'Network error. Please try again.' };
  }
}

/** Check in at the venue — creates a live ticket from the appointment. */
export async function checkInAppointment(
  calendarToken: string,
): Promise<{ ok: true; status: string; ticket?: { qr_token?: string; ticket_number?: string } | null } | { error: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/moderate-appointment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarToken, action: 'check_in' }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data?.error ?? 'Failed to check in' };
    return { ok: true, status: data?.status ?? 'checked_in', ticket: data?.ticket ?? null };
  } catch {
    return { error: 'Network error. Please try again.' };
  }
}

/** ICS download URL — hand this to Linking.openURL to let the OS open Calendar. */
export function getCalendarIcsUrl(calendarToken: string): string {
  return `${BASE_URL}/api/calendar/${encodeURIComponent(calendarToken)}`;
}

// ---------------------------------------------------------------------------
// Desk heartbeat — operator pings every 30s
// ---------------------------------------------------------------------------

export async function sendHeartbeat(deskId: string, staffId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/desk-heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deskId, staffId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Queue recovery — trigger immediate cleanup of stuck tickets
// ---------------------------------------------------------------------------

export async function triggerRecovery(): Promise<any> {
  try {
    const res = await fetch(`${BASE_URL}/api/queue-recovery`, { method: 'POST' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function stopTracking(ticketId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/tracking-stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
