/**
 * Data Adapter — routes all ticket/queue operations to either
 * Supabase (cloud mode) or Station HTTP API (local mode).
 *
 * Screens import from here instead of ticket-actions.ts directly.
 */

import { useLocalConnectionStore } from './local-connection-store';
import * as Cloud from './ticket-actions';
import * as Station from './station-client';

function getLocal() {
  const { mode, stationUrl, stationSession } = useLocalConnectionStore.getState();
  if (mode === 'local' && stationUrl && stationSession) {
    return { url: stationUrl, session: stationSession };
  }
  return null;
}

// ── Call Next ────────────────────────────────────────────────────

export async function callNextTicket(deskId: string, staffId: string) {
  const local = getLocal();
  if (local) {
    const officeId = local.session.office_id;
    return Station.stationCallNext(local.url, officeId, deskId, staffId);
  }
  return Cloud.callNextTicket(deskId, staffId);
}

// ── Call Specific Ticket ─────────────────────────────────────────

export async function callSpecificTicket(ticketId: string, deskId: string, staffId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'called',
      desk_id: deskId,
      called_by_staff_id: staffId,
      called_at: new Date().toISOString(),
    });
  }
  return Cloud.callSpecificTicket(ticketId, deskId, staffId);
}

// ── Start Serving ────────────────────────────────────────────────

export async function startServing(ticketId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'serving',
      serving_started_at: new Date().toISOString(),
    });
  }
  return Cloud.startServing(ticketId);
}

// ── Mark Served ──────────────────────────────────────────────────

export async function markServed(ticketId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'served',
      completed_at: new Date().toISOString(),
    });
  }
  return Cloud.markServed(ticketId);
}

// ── Mark No-Show ─────────────────────────────────────────────────

export async function markNoShow(ticketId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'no_show',
      completed_at: new Date().toISOString(),
    });
  }
  return Cloud.markNoShow(ticketId);
}

// ── Cancel Ticket ────────────────────────────────────────────────

export async function cancelTicket(ticketId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'cancelled',
      completed_at: new Date().toISOString(),
    });
  }
  return Cloud.cancelTicket(ticketId);
}

// ── Recall ───────────────────────────────────────────────────────

export async function recallTicket(ticketId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      called_at: new Date().toISOString(),
    });
  }
  return Cloud.recallTicket(ticketId);
}

// ── Reset to Queue ───────────────────────────────────────────────

export async function resetToQueue(ticketId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'waiting',
      desk_id: null,
      called_at: null,
      called_by_staff_id: null,
      serving_started_at: null,
      parked_at: null,
    });
  }
  return Cloud.resetToQueue(ticketId);
}

// ── Park Ticket ──────────────────────────────────────────────────

export async function parkTicket(ticketId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'waiting',
      desk_id: null,
      called_at: null,
      called_by_staff_id: null,
      serving_started_at: null,
      parked_at: new Date().toISOString(),
    });
  }
  return Cloud.parkTicket(ticketId);
}

// ── Resume Parked Ticket (call to desk) ──────────────────────────

export async function resumeParkedTicket(ticketId: string, deskId: string, staffId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'called',
      desk_id: deskId,
      called_by_staff_id: staffId,
      called_at: new Date().toISOString(),
      parked_at: null,
    });
  }
  return Cloud.resumeParkedTicket(ticketId, deskId, staffId);
}

// ── Unpark to Queue ──────────────────────────────────────────────

export async function unparkToQueue(ticketId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateTicket(local.url, ticketId, {
      status: 'waiting',
      parked_at: null,
    });
  }
  return Cloud.unparkToQueue(ticketId);
}

// ── Desk Status ──────────────────────────────────────────────────

export async function openDesk(deskId: string, staffId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateDesk(local.url, deskId, { status: 'open', current_staff_id: staffId });
  }
  return Cloud.openDesk(deskId, staffId);
}

export async function closeDeskStatus(deskId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateDesk(local.url, deskId, { status: 'closed' });
  }
  return Cloud.closeDeskStatus(deskId);
}

export async function setDeskOnBreak(deskId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateDesk(local.url, deskId, { status: 'on_break' });
  }
  return Cloud.setDeskOnBreak(deskId);
}

export async function setDeskOpen(deskId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationUpdateDesk(local.url, deskId, { status: 'open' });
  }
  return Cloud.setDeskOpen(deskId);
}

// ── Desk Heartbeat ───────────────────────────────────────────────

export async function pingDeskHeartbeat(deskId: string) {
  const local = getLocal();
  if (local) return; // Station manages its own heartbeat
  return Cloud.pingDeskHeartbeat(deskId);
}

// ── Safety functions (cloud-only, Station handles these internally) ──

export async function requeueExpiredCalls(timeoutSeconds = 90) {
  const local = getLocal();
  if (local) return 0; // Station handles this
  return Cloud.requeueExpiredCalls(timeoutSeconds);
}

export async function autoResolveTickets() {
  const local = getLocal();
  if (local) return {}; // Station handles this
  return Cloud.autoResolveTickets();
}

// ── Fetch Available Desks (local-aware) ─────────────────────────

export async function fetchAvailableDesks(officeId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationQuery(local.url, 'desks', [officeId]);
  }
  return Cloud.fetchAvailableDesks(officeId);
}

// ── Switch Desk (local-aware) ───────────────────────────────────

export async function switchDesk(deskId: string, staffId: string, oldDeskId?: string | null) {
  const local = getLocal();
  if (local) {
    // In local mode, query desks and return the selected one
    const desks = await Station.stationQuery(local.url, 'desks', [local.session.office_id]);
    const desk = desks.find((d: any) => d.id === deskId);
    if (!desk) throw new Error('Desk not found');
    return desk;
  }
  return Cloud.switchDesk(deskId, staffId, oldDeskId);
}

// ── Create In-House Ticket (local-aware) ────────────────────────

export async function createInHouseTicket(params: {
  officeId: string;
  departmentId: string;
  serviceId?: string;
  customerName?: string;
  customerPhone?: string;
  visitReason?: string;
  priority?: number;
  priorityCategoryId?: string | null;
}) {
  const local = getLocal();
  if (local) {
    const res = await Station.stationCreateTicket(local.url, {
      officeId: params.officeId,
      departmentId: params.departmentId,
      serviceId: params.serviceId,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      customerReason: params.visitReason,
      source: 'in_house',
    });
    // Station returns { ticket: { ... } } — unwrap and normalize
    const t = res.ticket ?? res;
    return {
      id: t.id,
      ticket_number: t.ticket_number,
      qr_token: t.qr_token ?? null,
      qr_data_url: t.qr_data_url ?? null,
      position: t.position,
      estimated_wait: t.estimated_wait,
      whatsappStatus: t.whatsappStatus ?? res.whatsappStatus,
    };
  }
  return Cloud.createInHouseTicket(params);
}

// ── Fetch Departments (local-aware) ─────────────────────────────

export async function fetchOfficeDepartments(officeId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationQuery(local.url, 'departments', [officeId]);
  }
  return Cloud.fetchOfficeDepartments(officeId);
}

// ── Fetch Services (local-aware) ────────────────────────────────

export async function fetchDepartmentServices(officeId: string) {
  const local = getLocal();
  if (local) {
    return Station.stationQuery(local.url, 'services', [officeId]);
  }
  return Cloud.fetchDepartmentServices(officeId);
}

// ── Transfer Ticket (local-aware) ───────────────────────────────

export async function transferTicket(
  ticketId: string,
  newDepartmentId: string,
  newServiceId?: string | null,
) {
  const local = getLocal();
  if (local) {
    // In local mode, cancel old ticket and create new one in the new department
    await Station.stationUpdateTicket(local.url, ticketId, {
      status: 'cancelled',
      completed_at: new Date().toISOString(),
      notes: 'Transferred',
    });
    return Station.stationCreateTicket(local.url, {
      officeId: local.session.office_id,
      departmentId: newDepartmentId,
      serviceId: newServiceId ?? undefined,
      source: 'transfer',
    });
  }
  return Cloud.transferTicket(ticketId, newDepartmentId, newServiceId);
}

// ── Re-export unchanged functions (cloud/admin-only features) ───

export {
  adjustBookingPriorities,
  cleanupStaleTickets,
  createStaff,
  updateStaff,
  createDesk,
  updateDesk,
  deleteDesk,
  createOffice,
  updateOffice,
  deleteOffice,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  createService,
  updateService,
  deleteService,
  createPriority,
  updatePriority,
  deletePriority,
  fetchAppointments,
  checkInAppointment,
  cancelAppointment,
  approveAppointment,
  declineAppointment,
  noShowAppointment,
  completeAppointment,
  deleteAppointment,
  fetchVirtualCodes,
  createVirtualCode,
  toggleVirtualCode,
  deleteVirtualCode,
} from './ticket-actions';
