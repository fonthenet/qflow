const BASE_URL = 'https://qflow-sigma.vercel.app';

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
        bundleId: params.bundleId ?? 'com.queueflow.mobile',
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
        packageName: params.packageName ?? 'com.queueflow.mobile',
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
  };
  offices: Array<{ id: string; name: string; address: string | null }>;
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
  office: { id: string; name: string; address: string | null; organization_id: string };
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
  office: { id: string; name: string; address: string | null };
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
// Booking / appointment
// ---------------------------------------------------------------------------

export interface BookingSlotsResponse {
  officeId: string;
  date: string;
  slots: string[]; // HH:MM
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
