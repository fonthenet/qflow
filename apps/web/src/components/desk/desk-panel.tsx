'use client';

import { useState, useEffect, useCallback, useRef, useTransition } from 'react';
import {
  PhoneForwarded,
  Play,
  CheckCircle2,
  UserX,
  ArrowRightLeft,
  Volume2,
  Smartphone,
  Clock,
  Users,
  Ticket,
  ChevronRight,
  Loader2,
  X,
  AlertCircle,
  TimerReset,
  MapPinned,
  Pause,
  LayoutGrid,
} from 'lucide-react';
import { useRealtimeQueue } from '@/lib/hooks/use-realtime-queue';
import { CALL_WAIT_SECONDS } from '@/lib/queue/call-timing';
import {
  callNextTicket,
  callSpecificTicket,
  startServing,
  markServed,
  markNoShow,
  transferTicket,
  recallTicket,
  buzzTicket,
  callBackTicketToDesk,
  resetTicketToQueue,
  assignRestaurantTable,
  clearRestaurantTable,
  parkTicket,
  unparkTicket,
} from '@/lib/actions/ticket-actions';
import { CustomerDataCard } from '@/components/desk/customer-data-card';
import { PriorityBadge } from '@/components/tickets/priority-badge';
import type { Database } from '@/lib/supabase/database.types';
import type { CustomerDataScope } from '@/lib/privacy';
import type { QueueData } from '@/lib/hooks/use-realtime-queue';
import type { IndustryVertical, TemplateVocabulary } from '@queueflow/shared';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type Department = Database['public']['Tables']['departments']['Row'];
type Service = Database['public']['Tables']['services']['Row'];
type IntakeField = Database['public']['Tables']['intake_form_fields']['Row'];
type RestaurantTable = Database['public']['Tables']['restaurant_tables']['Row'];

interface DeskPanelProps {
  desk: {
    id: string;
    name: string;
    display_name: string | null;
    department_id: string;
    office_id: string;
  };
  staffName: string;
  departments: Department[];
  services: Service[];
  priorityCategories?: Array<{
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
  }>;
  currentTicketFields?: IntakeField[];
  customerDataScope?: CustomerDataScope;
  initialCurrentTicket?: Ticket | null;
  restaurantTables?: RestaurantTable[];
  platformContext?: {
    vertical?: IndustryVertical;
    vocabulary?: TemplateVocabulary;
    officeSettings?: Record<string, unknown>;
  };
  sandbox?: {
    enabled: boolean;
    initialQueue: QueueData;
  };
}

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface RestaurantTablePreset {
  code: string;
  label: string;
  zone?: string;
  capacity?: number;
  minPartySize?: number;
  maxPartySize?: number;
  reservable?: boolean;
}

interface RestaurantServiceArea {
  id: string;
  label: string;
  type?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toTitleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeRestaurantLabel(value: string | null) {
  if (!value) return null;
  return value.replace(/^table\b/i, 'Party').replace(/^party of\b/i, 'Party of');
}

function mergeCustomerData(
  customerData: Ticket['customer_data'],
  patch: Record<string, unknown>
) {
  const base =
    customerData && typeof customerData === 'object' && !Array.isArray(customerData)
      ? (customerData as Record<string, unknown>)
      : {};
  return { ...base, ...patch };
}

function stripAssignedTable(customerData: Ticket['customer_data']) {
  const base =
    customerData && typeof customerData === 'object' && !Array.isArray(customerData)
      ? { ...(customerData as Record<string, unknown>) }
      : {};
  delete base.assigned_table_code;
  delete base.assigned_table_label;
  return base;
}

function useServiceTimer(startTime: string | null) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startTime) {
      setElapsed(0);
      return;
    }

    const start = new Date(startTime).getTime();
    const tick = () => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return {
    elapsed,
    formatted: `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
    minutes,
    seconds,
  };
}

function useCallCountdown(calledAt: string | null) {
  const [remaining, setRemaining] = useState(CALL_WAIT_SECONDS);

  useEffect(() => {
    if (!calledAt) {
      setRemaining(CALL_WAIT_SECONDS);
      return;
    }

    const start = new Date(calledAt).getTime();
    const tick = () => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      setRemaining(Math.max(0, CALL_WAIT_SECONDS - elapsed));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [calledAt]);

  return remaining;
}

export function DeskPanel({
  desk,
  staffName,
  departments,
  services,
  priorityCategories = [],
  currentTicketFields = [],
  customerDataScope = 'staff',
  initialCurrentTicket,
  restaurantTables = [],
  platformContext,
  sandbox,
}: DeskPanelProps) {
  const sandboxMode = Boolean(sandbox?.enabled);
  const [currentTicket, setCurrentTicket] = useState<Ticket | null>(
    initialCurrentTicket ?? null
  );
  const [sandboxQueue, setSandboxQueue] = useState<QueueData>(
    sandbox?.initialQueue ?? {
      waiting: [],
      called: [],
      serving: [],
      recentlyServed: [],
      cancelled: [],
    }
  );
  const [tableState, setTableState] = useState<RestaurantTable[]>(restaurantTables);
  const [lastAction, setLastAction] = useState<{
    ticketNumber: string;
    action: 'served' | 'no_show' | 'cancelled' | 'transferred' | 'reset';
    time: Date;
  } | null>(null);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [showTableMapModal, setShowTableMapModal] = useState(false);
  const [tableMapFilter, setTableMapFilter] = useState<'all' | 'available' | 'occupied'>('all');
  const [tableMapZoneFilter, setTableMapZoneFilter] = useState<string | null>(null);
  const [transferDeptId, setTransferDeptId] = useState('');
  const [transferServiceId, setTransferServiceId] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isPending, startTransition] = useTransition();
  const toastIdRef = useRef(0);

  const { queue: liveQueue, isLoading } = useRealtimeQueue({
    officeId: desk.office_id,
    departmentId: desk.department_id,
    disabled: sandboxMode,
    initialQueue: sandbox?.initialQueue,
  });
  const queue = sandboxMode ? sandboxQueue : liveQueue;
  useEffect(() => {
    setTableState(restaurantTables);
  }, [restaurantTables]);
  const vocabulary = platformContext?.vocabulary;
  const officeSettings = platformContext?.officeSettings ?? {};
  const restaurantTablePresets = (
    Array.isArray(officeSettings.platform_table_presets)
      ? officeSettings.platform_table_presets
      : []
  )
    .map((entry) => asRecord(entry))
    .map(
      (entry) =>
        ({
          code: asString(entry.code) ?? '',
          label: asString(entry.label) ?? asString(entry.code) ?? 'Table',
          zone: asString(entry.zone) ?? undefined,
          capacity: asNumber(entry.capacity) ?? undefined,
          minPartySize: asNumber(entry.minPartySize) ?? undefined,
          maxPartySize: asNumber(entry.maxPartySize) ?? undefined,
          reservable: asBoolean(entry.reservable) ?? undefined,
        }) satisfies RestaurantTablePreset
    )
    .filter((entry) => entry.code.length > 0);
  const restaurantAreas = (
    Array.isArray(officeSettings.platform_service_areas)
      ? officeSettings.platform_service_areas
      : []
  )
    .map((entry) => asRecord(entry))
    .map(
      (entry) =>
        ({
          id: asString(entry.id) ?? '',
          label: asString(entry.label) ?? 'Area',
          type: asString(entry.type) ?? undefined,
        }) satisfies RestaurantServiceArea
    )
    .filter((entry) => entry.id.length > 0);
  const isRestaurantMode =
    platformContext?.vertical === 'restaurant' || restaurantTablePresets.length > 0;
  const isClinicMode = platformContext?.vertical === 'clinic';
  const isBankMode = platformContext?.vertical === 'bank';
  const isBarbershopMode = platformContext?.vertical === 'barbershop';
  const allowMultiCall = isRestaurantMode || isBarbershopMode;
  const customerLabel = vocabulary?.customerLabel ?? 'Customer';
  const queueLabel = vocabulary?.queueLabel ?? 'Queue';
  const serviceLabel = vocabulary?.serviceLabel ?? 'Service';
  const deskLabel = vocabulary?.deskLabel ?? 'Desk';
  const bookingLabel = vocabulary?.bookingLabel ?? 'Booking';

  const timer = useServiceTimer(
    currentTicket?.status === 'serving' ? currentTicket.serving_started_at : null
  );

  const callCountdown = useCallCountdown(
    currentTicket?.status === 'called' ? currentTicket.called_at : null
  );

  // Sync current ticket from realtime data
  useEffect(() => {
    if (!currentTicket) return;

    // Check if our current ticket still exists in active states
    const allActive = [...queue.called, ...queue.serving];
    const updated = allActive.find((t) => t.id === currentTicket.id);
    if (updated) {
      // Don't re-adopt a ticket that was just parked
      if (updated.parked_at != null) {
        setCurrentTicket(null);
        return;
      }
      // Only sync if the realtime data is newer (avoid overwriting optimistic recall updates)
      const currentCalledAt = currentTicket.called_at ? new Date(currentTicket.called_at).getTime() : 0;
      const updatedCalledAt = updated.called_at ? new Date(updated.called_at).getTime() : 0;
      if (updatedCalledAt >= currentCalledAt) {
        setCurrentTicket(updated);
      }
      return;
    }

    const waitingTicket = queue.waiting.find((t) => t.id === currentTicket.id);
    if (waitingTicket) {
      setCurrentTicket(null);
      return;
    }

    const cancelledTicket = queue.cancelled.find((t) => t.id === currentTicket.id);
    if (cancelledTicket) {
      setLastAction({ ticketNumber: currentTicket.ticket_number, action: 'cancelled', time: new Date() });
      setCurrentTicket(null);
      return;
    }

    if (
      currentTicket.status === 'serving' ||
      currentTicket.status === 'called'
    ) {
      const inServed = queue.recentlyServed.find(
        (t) => t.id === currentTicket.id
      );
      if (inServed) {
        setCurrentTicket(null);
      }
    }
  }, [queue, currentTicket]);

  const addToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleCallNext = () => {
    if (!canCallNext) {
      addToast('Finish or complete the current ticket before calling the next one.', 'error');
      return;
    }
    if (sandboxMode) {
      const nextTicket = queue.waiting[0];
      if (!nextTicket) return;
      const calledTicket = {
        ...nextTicket,
        status: 'called' as const,
        called_at: new Date().toISOString(),
        desk_id: desk.id,
      };
      setSandboxQueue((current) => ({
        ...current,
        waiting: current.waiting.filter((ticket) => ticket.id !== nextTicket.id),
        called: [calledTicket, ...current.called.filter((ticket) => ticket.id !== nextTicket.id)],
      }));
      setCurrentTicket(calledTicket);
      addToast(
        isRestaurantMode
          ? `Notified party ${calledTicket.ticket_number}`
          : `Called ticket ${calledTicket.ticket_number}`,
        'info'
      );
      return;
    }
    startTransition(async () => {
      const result = await callNextTicket(desk.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      setCurrentTicket(result.data);
      addToast(
        isRestaurantMode
          ? `Notified party ${result.data.ticket_number}`
          : `Called ticket ${result.data.ticket_number}`,
        'info'
      );
    });
  };

  const handleStartServing = () => {
    if (!currentTicket) return;
    if (isRestaurantMode && currentTicket.status === 'called' && !currentAssignedTableCode) {
      setShowTableMapModal(true);
      addToast('Choose a table to seat this party.', 'info');
      return;
    }
    if (sandboxMode) {
      const servingTicket = {
        ...currentTicket,
        status: 'serving' as const,
        serving_started_at: new Date().toISOString(),
      };
      setSandboxQueue((current) => ({
        ...current,
        called: current.called.filter((ticket) => ticket.id !== currentTicket.id),
        serving: [servingTicket, ...current.serving.filter((ticket) => ticket.id !== currentTicket.id)],
      }));
      setCurrentTicket(servingTicket);
      addToast(isRestaurantMode ? 'Party is now being seated' : 'Now serving customer');
      return;
    }
    startTransition(async () => {
      const result = await startServing(currentTicket.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      setCurrentTicket(result.data);
      addToast(isRestaurantMode ? 'Party is now being seated' : 'Now serving customer');
    });
  };

  const handleMarkServed = () => {
    if (!currentTicket) return;
    if (sandboxMode) {
      const servedTicket = {
        ...currentTicket,
        status: 'served' as const,
        completed_at: new Date().toISOString(),
      };
      setSandboxQueue((current) => ({
        ...current,
        called: current.called.filter((ticket) => ticket.id !== currentTicket.id),
        serving: current.serving.filter((ticket) => ticket.id !== currentTicket.id),
        recentlyServed: [servedTicket, ...current.recentlyServed].slice(0, 5),
      }));
      setTableState((current) =>
        current.map((table) =>
          table.current_ticket_id === currentTicket.id
            ? { ...table, status: 'available', current_ticket_id: null, assigned_at: null }
            : table
        )
      );
      setLastAction({ ticketNumber: currentTicket.ticket_number, action: 'served', time: new Date() });
      setCurrentTicket(null);
      addToast(isRestaurantMode ? 'Party closed and table finished' : 'Customer marked as served', 'success');
      return;
    }
    startTransition(async () => {
      const result = await markServed(currentTicket.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      setLastAction({ ticketNumber: currentTicket.ticket_number, action: 'served', time: new Date() });
      setCurrentTicket(null);
      addToast(isRestaurantMode ? 'Party closed and table finished' : 'Customer marked as served', 'success');
    });
  };

  const handleNoShow = () => {
    if (!currentTicket) return;
    if (sandboxMode) {
      setSandboxQueue((current) => ({
        ...current,
        called: current.called.filter((ticket) => ticket.id !== currentTicket.id),
        serving: current.serving.filter((ticket) => ticket.id !== currentTicket.id),
      }));
      setTableState((current) =>
        current.map((table) =>
          table.current_ticket_id === currentTicket.id
            ? { ...table, status: 'available', current_ticket_id: null, assigned_at: null }
            : table
        )
      );
      setLastAction({ ticketNumber: currentTicket.ticket_number, action: 'no_show', time: new Date() });
      setCurrentTicket(null);
      addToast(isRestaurantMode ? 'Party marked as no-show' : 'Ticket marked as no-show', 'info');
      return;
    }
    startTransition(async () => {
      const result = await markNoShow(currentTicket.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      setLastAction({ ticketNumber: currentTicket.ticket_number, action: 'no_show', time: new Date() });
      setCurrentTicket(null);
      addToast(isRestaurantMode ? 'Party marked as no-show' : 'Ticket marked as no-show', 'info');
    });
  };

  const handleRecall = () => {
    if (!currentTicket) return;
    if (sandboxMode) {
      const recalledTicket = { ...currentTicket, called_at: new Date().toISOString() };
      setCurrentTicket(recalledTicket);
      setSandboxQueue((current) => ({
        ...current,
        called: current.called.map((ticket) =>
          ticket.id === currentTicket.id ? recalledTicket : ticket
        ),
      }));
      addToast(isRestaurantMode ? 'Party notified again — timer reset' : 'Recall alert sent — timer reset', 'info');
      return;
    }
    startTransition(async () => {
      const result = await recallTicket(currentTicket.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      const smsSent = 'smsSent' in result && result.smsSent === true;
      // Update local state so countdown resets
      setCurrentTicket((prev) =>
        prev ? { ...prev, called_at: new Date().toISOString() } : prev
      );
      addToast(
        smsSent
          ? isRestaurantMode
            ? 'Party notified again — timer reset and text backup delivered'
            : 'Recall alert sent — timer reset and text backup delivered'
          : isRestaurantMode
            ? 'Party notified again — timer reset'
            : 'Recall alert sent — timer reset',
        'info'
      );
    });
  };

  const handleBuzz = () => {
    if (!currentTicket) return;
    if (sandboxMode) {
      addToast(isRestaurantMode ? 'Ready alert sent to party' : 'Buzz alert sent', 'info');
      return;
    }
    startTransition(async () => {
      const result = await buzzTicket(currentTicket.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      const smsSent = 'smsSent' in result && result.smsSent === true;
      addToast(
        smsSent
          ? isRestaurantMode
            ? 'Ready alert sent by push + text'
            : 'Buzz alert sent by push + text'
          : isRestaurantMode
            ? 'Ready alert sent'
            : 'Buzz alert sent',
        'info'
      );
    });
  };

  const handleResetToQueue = () => {
    if (!currentTicket) return;
    if (sandboxMode) {
      const resetTicket = {
        ...currentTicket,
        status: 'waiting' as const,
        called_at: null,
        serving_started_at: null,
        desk_id: null,
      };
      setSandboxQueue((current) => ({
        ...current,
        called: current.called.filter((ticket) => ticket.id !== currentTicket.id),
        serving: current.serving.filter((ticket) => ticket.id !== currentTicket.id),
        waiting: [...current.waiting, resetTicket],
      }));
      setTableState((current) =>
        current.map((table) =>
          table.current_ticket_id === currentTicket.id
            ? { ...table, status: 'available', current_ticket_id: null, assigned_at: null }
            : table
        )
      );
      setLastAction({ ticketNumber: currentTicket.ticket_number, action: 'reset', time: new Date() });
      setCurrentTicket(null);
      addToast(isRestaurantMode ? 'Party sent back to waitlist' : 'Ticket reset to queue', 'info');
      return;
    }
    startTransition(async () => {
      const result = await resetTicketToQueue(currentTicket.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      setLastAction({ ticketNumber: currentTicket.ticket_number, action: 'reset', time: new Date() });
      setCurrentTicket(null);
      addToast(isRestaurantMode ? 'Party sent back to waitlist' : 'Ticket reset to queue', 'info');
    });
  };

  const handleTransfer = () => {
    if (!currentTicket || !transferDeptId || !transferServiceId) return;
    if (sandboxMode) {
      const transferredTicket = {
        ...currentTicket,
        status: 'waiting' as const,
        department_id: transferDeptId,
        service_id: transferServiceId,
        desk_id: null,
        called_at: null,
        serving_started_at: null,
      };
      setSandboxQueue((current) => ({
        ...current,
        called: current.called.filter((ticket) => ticket.id !== currentTicket.id),
        serving: current.serving.filter((ticket) => ticket.id !== currentTicket.id),
        waiting: [...current.waiting, transferredTicket],
      }));
      setTableState((current) =>
        current.map((table) =>
          table.current_ticket_id === currentTicket.id
            ? { ...table, status: 'available', current_ticket_id: null, assigned_at: null }
            : table
        )
      );
      setLastAction({ ticketNumber: currentTicket.ticket_number, action: 'transferred', time: new Date() });
      setCurrentTicket(null);
      setShowTransferDialog(false);
      setTransferDeptId('');
      setTransferServiceId('');
      addToast(
        `${isRestaurantMode ? 'Moved to' : 'Transferred to'} ${departments.find((d) => d.id === transferDeptId)?.name ?? 'department'}`,
        'success'
      );
      return;
    }
    startTransition(async () => {
      const result = await transferTicket(
        currentTicket.id,
        transferDeptId,
        transferServiceId
      );
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      setLastAction({ ticketNumber: currentTicket.ticket_number, action: 'transferred', time: new Date() });
      setCurrentTicket(null);
      setShowTransferDialog(false);
      setTransferDeptId('');
      setTransferServiceId('');
      addToast(
        `${isRestaurantMode ? 'Moved to' : 'Transferred to'} ${departments.find((d) => d.id === transferDeptId)?.name ?? 'department'}`,
        'success'
      );
    });
  };

  const handleBuzzSpecificTicket = (ticket: Ticket) => {
    if (sandboxMode) {
      const now = new Date().toISOString();
      const calledTicket = {
        ...ticket,
        status: 'called' as const,
        called_at: now,
        serving_started_at: null,
        recall_count: (ticket.recall_count ?? 0) + 1,
      };
      setCurrentTicket(calledTicket);
  
      setSandboxQueue((current) => ({
        ...current,
        called: [calledTicket, ...current.called.filter((entry) => entry.id !== ticket.id)],
        serving: current.serving.filter((entry) => entry.id !== ticket.id),
      }));
      addToast(
        isRestaurantMode
          ? `Brought ${getTicketCustomerName(ticket) ?? 'party'} back to the front host card`
          : 'Buzz alert sent',
        'info'
      );
      return;
    }
    startTransition(async () => {
      const result = await callBackTicketToDesk(ticket.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      setCurrentTicket(result.data);
  
      const smsSent = 'smsSent' in result && result.smsSent === true;
      addToast(
        smsSent
          ? isRestaurantMode
            ? `Brought ${getTicketCustomerName(result.data) ?? 'party'} back to the front host card by push + text`
            : 'Buzz alert sent by push + text'
          : isRestaurantMode
            ? `Brought ${getTicketCustomerName(result.data) ?? 'party'} back to the front host card`
            : 'Buzz alert sent',
        'info'
      );
    });
  };

  const handleResumeTicket = (ticket: Ticket) => {
    setCurrentTicket(ticket);

    addToast(
      isRestaurantMode
        ? `Resumed ${getTicketCustomerName(ticket) ?? 'party'} on the host stand`
        : `Resumed ticket ${ticket.ticket_number}`,
      'info'
    );
  };

  const handleParkTicket = () => {
    if (!currentTicket) return;
    if (sandboxMode) {
      const parked = { ...currentTicket, parked_at: new Date().toISOString() } as Ticket;
      setSandboxQueue((current) => ({
        ...current,
        called: current.called.map((t) => (t.id === parked.id ? parked : t)),
        serving: current.serving.map((t) => (t.id === parked.id ? parked : t)),
      }));
      setCurrentTicket(null);
      addToast(
        isRestaurantMode
          ? `Parked ${getTicketCustomerName(currentTicket) ?? 'party'} on hold`
          : isClinicMode
            ? `Patient ${currentTicket.ticket_number} placed on hold`
            : isBarbershopMode
              ? `Client ${currentTicket.ticket_number} placed on hold`
              : `Ticket ${currentTicket.ticket_number} parked on hold`,
        'info'
      );
      return;
    }
    const ticketRef = currentTicket;
    startTransition(async () => {
      const result = await parkTicket(ticketRef.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      setCurrentTicket(null);
      addToast(
        isRestaurantMode
          ? `Parked ${getTicketCustomerName(ticketRef) ?? 'party'} on hold`
          : `Ticket ${ticketRef.ticket_number} parked on hold`,
        'info'
      );
    });
  };

  const handleUnparkTicket = (ticket: Ticket) => {
    if (sandboxMode) {
      const unparked = { ...ticket, parked_at: null } as Ticket;
      setSandboxQueue((current) => ({
        ...current,
        called: current.called.map((t) => (t.id === unparked.id ? unparked : t)),
        serving: current.serving.map((t) => (t.id === unparked.id ? unparked : t)),
      }));
      setCurrentTicket(unparked);
  
      addToast(
        isRestaurantMode
          ? `Resumed ${getTicketCustomerName(ticket) ?? 'party'} from hold`
          : `Resumed ticket ${ticket.ticket_number} from hold`,
        'info'
      );
      return;
    }
    startTransition(async () => {
      const result = await unparkTicket(ticket.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      setCurrentTicket(result.data);
  
      addToast(
        isRestaurantMode
          ? `Resumed ${getTicketCustomerName(ticket) ?? 'party'} from hold`
          : `Resumed ticket ${ticket.ticket_number} from hold`,
        'info'
      );
    });
  };

  const handleParkSpecificTicket = (ticket: Ticket) => {
    if (sandboxMode) {
      const parked = { ...ticket, parked_at: new Date().toISOString() } as Ticket;
      setSandboxQueue((current) => ({
        ...current,
        called: current.called.map((t) => (t.id === parked.id ? parked : t)),
        serving: current.serving.map((t) => (t.id === parked.id ? parked : t)),
      }));
      if (currentTicket?.id === ticket.id) setCurrentTicket(null);
      addToast(
        isRestaurantMode
          ? `Parked ${getTicketCustomerName(ticket) ?? 'party'} on hold`
          : `Ticket ${ticket.ticket_number} parked on hold`,
        'info'
      );
      return;
    }
    startTransition(async () => {
      const result = await parkTicket(ticket.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      if (currentTicket?.id === ticket.id) setCurrentTicket(null);
      addToast(
        isRestaurantMode
          ? `Parked ${getTicketCustomerName(ticket) ?? 'party'} on hold`
          : `Ticket ${ticket.ticket_number} parked on hold`,
        'info'
      );
    });
  };

  const handleCallWaitingTicket = (ticket: Ticket) => {
    if (!canCallNext) {
      addToast('Finish or complete the current ticket before calling the next one.', 'error');
      return;
    }
    if (sandboxMode) {
      const calledTicket = {
        ...ticket,
        status: 'called' as const,
        called_at: new Date().toISOString(),
        desk_id: desk.id,
      };
      setSandboxQueue((current) => ({
        ...current,
        waiting: current.waiting.filter((entry) => entry.id !== ticket.id),
        called: [calledTicket, ...current.called.filter((entry) => entry.id !== ticket.id)],
      }));
      setCurrentTicket((current) =>
        current?.status === 'serving' ? current : calledTicket
      );
      addToast(
        isRestaurantMode
          ? `Notified party ${calledTicket.ticket_number}`
          : `Called ticket ${calledTicket.ticket_number}`,
        'info'
      );
      return;
    }

    startTransition(async () => {
      const result = await callSpecificTicket(desk.id, ticket.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      if (!currentTicket || currentTicket.status !== 'serving') {
        setCurrentTicket(result.data);
      }
      addToast(
        isRestaurantMode
          ? `Notified party ${result.data.ticket_number}`
          : `Called ticket ${result.data.ticket_number}`,
        'info'
      );
    });
  };

  const handleAssignRestaurantTable = (table: RestaurantTable) => {
    if (!currentTicket) return;

    if (sandboxMode) {
      const now = new Date().toISOString();
      const updatedTicket = {
        ...currentTicket,
        status: currentTicket.status === 'called' ? ('serving' as const) : currentTicket.status,
        serving_started_at:
          currentTicket.status === 'called'
            ? now
            : currentTicket.serving_started_at,
        customer_data: mergeCustomerData(currentTicket.customer_data, {
          assigned_table_code: table.code,
          assigned_table_label: table.label,
        }),
      } as Ticket;
      setTableState((current) =>
        current.map((entry) =>
          entry.id === table.id
            ? {
                ...entry,
                status: 'occupied',
                current_ticket_id: currentTicket.id,
                assigned_at: now,
              }
            : entry.current_ticket_id === currentTicket.id
              ? {
                  ...entry,
                  status: 'available',
                  current_ticket_id: null,
                  assigned_at: null,
                }
              : entry
        )
      );
      setSandboxQueue((current) => {
        const nextCalled =
          currentTicket.status === 'called'
            ? current.called.filter((ticket) => ticket.id !== currentTicket.id)
            : current.called.map((ticket) =>
                ticket.id === currentTicket.id ? updatedTicket : ticket
              );
        const nextServing =
          currentTicket.status === 'called'
            ? [updatedTicket, ...current.serving.filter((ticket) => ticket.id !== currentTicket.id)]
            : current.serving.map((ticket) =>
                ticket.id === currentTicket.id ? updatedTicket : ticket
              );

        return {
          ...current,
          called: nextCalled,
          serving: nextServing,
        };
      });
      setCurrentTicket(null);
      addToast(`Seated ${getTicketCustomerName(updatedTicket) ?? 'party'} at ${table.code}`);
      return;
    }

    startTransition(async () => {
      const result = await assignRestaurantTable(currentTicket.id, table.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      if (!result.data) {
        addToast('Table assignment did not return updated data', 'error');
        return;
      }
      setTableState((current) =>
        current.map((entry) =>
          entry.id === result.data.table.id
            ? result.data.table
            : entry.current_ticket_id === result.data.ticket.id
              ? {
                  ...entry,
                  status: 'available',
                  current_ticket_id: null,
                  assigned_at: null,
                }
              : entry
        )
      );
      setCurrentTicket(null);
      addToast(`Seated ${getTicketCustomerName(result.data.ticket) ?? 'party'} at ${result.data.table.code}`);
    });
  };

  const handleClearRestaurantTable = (table: RestaurantTable) => {
    if (sandboxMode) {
      const ticketId = table.current_ticket_id;
      setTableState((current) =>
        current.map((entry) =>
          entry.id === table.id
            ? { ...entry, status: 'available', current_ticket_id: null, assigned_at: null }
            : entry
        )
      );
      if (ticketId) {
        setSandboxQueue((current) => ({
          ...current,
          called: current.called.map((ticket) =>
            ticket.id === ticketId
              ? ({
                  ...ticket,
                  customer_data: stripAssignedTable(ticket.customer_data),
                } as Ticket)
              : ticket
          ),
          serving: current.serving.map((ticket) =>
            ticket.id === ticketId
              ? ({
                  ...ticket,
                  customer_data: stripAssignedTable(ticket.customer_data),
                } as Ticket)
              : ticket
          ),
        }));
        setCurrentTicket((current) =>
          current?.id === ticketId
            ? ({
                ...current,
                customer_data: stripAssignedTable(current.customer_data),
              } as Ticket)
            : current
        );
      }
      addToast(`Cleared ${table.code}`, 'success');
      return;
    }

    startTransition(async () => {
      const result = await clearRestaurantTable(table.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      if (!result.data) {
        addToast('Table clear did not return updated data', 'error');
        return;
      }
      setTableState((current) =>
        current.map((entry) => (entry.id === result.data.table.id ? result.data.table : entry))
      );
      setCurrentTicket((current) =>
        current?.id === (result.data?.ticket as { id?: string } | null)?.id
          ? ({
              ...(result.data.ticket as Ticket),
            } as Ticket)
          : current
      );
      addToast(`Cleared ${result.data.table.code}`, 'success');
    });
  };

  const transferableServices = services.filter(
    (s) => s.department_id === transferDeptId && s.is_active
  );

  const ticketStatus = currentTicket?.status;
  const isIdle = !currentTicket;
  const isCalled = ticketStatus === 'called';
  const isServing = ticketStatus === 'serving';
  const departmentMap = new Map(departments.map((department) => [department.id, department]));
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const getPriorityCategory = useCallback(
    (ticket: Ticket | null | undefined) =>
      priorityCategories.find((category) => category.id === ticket?.priority_category_id) ?? null,
    [priorityCategories]
  );

  const getTicketServiceName = useCallback(
    (ticket: Ticket | null | undefined) =>
      (ticket?.service_id ? serviceMap.get(ticket.service_id)?.name : null) ?? 'Unknown service',
    [serviceMap]
  );

  const getTicketDepartmentName = useCallback(
    (ticket: Ticket | null | undefined) =>
      (ticket?.department_id ? departmentMap.get(ticket.department_id)?.name : null) ?? 'Unknown department',
    [departmentMap]
  );

  const getTicketCustomerName = useCallback((ticket: Ticket | null | undefined) => {
    if (!ticket?.customer_data || typeof ticket.customer_data !== 'object' || Array.isArray(ticket.customer_data)) {
      return null;
    }

    const data = ticket.customer_data as Record<string, unknown>;
    const candidate =
      asString(data.party_name) ??
      asString(data.name) ??
      asString(data.full_name);
    return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : null;
  }, []);

  const getRestaurantPartySize = useCallback((ticket: Ticket | null | undefined) => {
    if (!ticket?.customer_data || typeof ticket.customer_data !== 'object' || Array.isArray(ticket.customer_data)) {
      return null;
    }

    const data = ticket.customer_data as Record<string, unknown>;
    const fromData = asNumber(data.party_size);
    if (fromData) return fromData;

    const serviceName = getTicketServiceName(ticket);
    const match = serviceName.match(/(\d+)(?:\s*-\s*(\d+)|\+)?/);
    if (!match) return null;
    const maxValue = match[2] ? Number(match[2]) : Number(match[1]);
    return Number.isFinite(maxValue) ? maxValue : null;
  }, [getTicketServiceName]);

  const getRestaurantSeatingPreference = useCallback((ticket: Ticket | null | undefined) => {
    if (!ticket?.customer_data || typeof ticket.customer_data !== 'object' || Array.isArray(ticket.customer_data)) {
      return null;
    }

    const data = ticket.customer_data as Record<string, unknown>;
    const rawPreference = asString(data.seating_preference);
    if (!rawPreference) return null;
    return toTitleCase(rawPreference.replace(/-/g, ' '));
  }, []);

  const getReservationReference = useCallback((ticket: Ticket | null | undefined) => {
    if (!ticket?.customer_data || typeof ticket.customer_data !== 'object' || Array.isArray(ticket.customer_data)) {
      return null;
    }
    return asString((ticket.customer_data as Record<string, unknown>).reservation_reference);
  }, []);

  const getAssignedTableCode = useCallback((ticket: Ticket | null | undefined) => {
    if (!ticket?.customer_data || typeof ticket.customer_data !== 'object' || Array.isArray(ticket.customer_data)) {
      return null;
    }
    return asString((ticket.customer_data as Record<string, unknown>).assigned_table_code);
  }, []);

  const getAssignedTableLabel = useCallback((ticket: Ticket | null | undefined) => {
    if (!ticket?.customer_data || typeof ticket.customer_data !== 'object' || Array.isArray(ticket.customer_data)) {
      return null;
    }
    return asString((ticket.customer_data as Record<string, unknown>).assigned_table_label);
  }, []);

  const getRestaurantNeeds = useCallback((ticket: Ticket | null | undefined) => {
    if (!ticket?.customer_data || typeof ticket.customer_data !== 'object' || Array.isArray(ticket.customer_data)) {
      return [] as string[];
    }

    const data = ticket.customer_data as Record<string, unknown>;
    const items: string[] = [];
    if (asBoolean(data.accessibility_seating)) items.push('Accessible seating');
    if (asBoolean(data.high_chair)) items.push('High chair');
    return items;
  }, []);

  const getTicketSource = useCallback((ticket: Ticket | null | undefined) => {
    if (!ticket) return 'Unknown';
    if (ticket.appointment_id) return isRestaurantMode ? bookingLabel : 'Appointment';
    if (ticket.is_remote) return isRestaurantMode ? 'Remote waitlist' : 'Remote join';
    return isRestaurantMode ? 'Walk-in party' : 'Walk-in';
  }, [bookingLabel, isRestaurantMode]);

  const formatAbsoluteTime = useCallback((value: string | null | undefined) => {
    if (!value) return '--';
    return new Date(value).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  }, []);

  const formatRelativeTime = useCallback((value: string | null | undefined) => {
    if (!value) return '--';
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
    if (elapsedMinutes < 1) return 'Just now';
    if (elapsedMinutes === 1) return '1 min ago';
    if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;
    const hours = Math.floor(elapsedMinutes / 60);
    const minutes = elapsedMinutes % 60;
    return minutes === 0 ? `${hours}h ago` : `${hours}h ${minutes}m ago`;
  }, []);

  const waitingTickets = queue.waiting;
  const parkedTickets = [...queue.called, ...queue.serving].filter(
    (ticket) => ticket.parked_at != null && ticket.desk_id === desk.id
  );
  const calledAtThisDesk = queue.called.filter(
    (ticket) => ticket.desk_id === desk.id && ticket.parked_at == null && ticket.id !== currentTicket?.id
  );
  const hasActiveTicketAtDesk = currentTicket != null || calledAtThisDesk.length > 0 || queue.serving.some(
    (ticket) => ticket.desk_id === desk.id && ticket.parked_at == null
  );
  const canCallNext = allowMultiCall || !hasActiveTicketAtDesk;
  const seatedTicketIds = new Set(
    tableState
      .filter((t) => t.current_ticket_id != null)
      .map((t) => t.current_ticket_id as string)
  );
  const activeElsewhere = [...queue.called, ...queue.serving].filter(
    (ticket) =>
      ticket.id !== currentTicket?.id &&
      ticket.parked_at == null &&
      !seatedTicketIds.has(ticket.id) &&
      !(ticket.desk_id === desk.id && ticket.status === 'called')
  );
  const nextWaitingTicket = waitingTickets[0] ?? null;
  const longestWaitingMinutes = waitingTickets.reduce((longest, ticket) => {
    if (!ticket.created_at) return longest;
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(ticket.created_at).getTime()) / 60000));
    return Math.max(longest, elapsed);
  }, 0);
  const queueStateLabel = isRestaurantMode
    ? isServing
      ? 'Party seated now'
      : isCalled
        ? 'Waiting for party to arrive'
        : 'Ready to notify the next party'
    : isClinicMode
      ? isServing
        ? 'Patient in consultation'
        : isCalled
          ? 'Waiting for patient'
          : 'Ready for next patient'
    : isBarbershopMode
      ? isServing
        ? 'Client in chair'
        : isCalled
          ? 'Waiting for client'
          : 'Ready for next client'
    : isBankMode
      ? isServing
        ? 'Serving client now'
        : isCalled
          ? 'Client called to counter'
          : 'Ready for next client'
    : isServing
      ? 'Serving now'
      : isCalled
        ? 'Waiting for customer'
        : 'Ready for next ticket';
  const currentPartySize = getRestaurantPartySize(currentTicket);
  const currentPreference = getRestaurantSeatingPreference(currentTicket);
  const currentNeeds = getRestaurantNeeds(currentTicket);
  const currentReservationReference = getReservationReference(currentTicket);
  const currentAssignedTableCode = getAssignedTableCode(currentTicket);
  const currentAssignedTableLabel = getAssignedTableLabel(currentTicket);
  const currentServiceName = normalizeRestaurantLabel(getTicketServiceName(currentTicket)) ?? getTicketServiceName(currentTicket);
  const getSuggestedTablesForTicket = useCallback(
    (ticket: Ticket | null | undefined) => {
      if (!isRestaurantMode || !ticket) return [] as RestaurantTablePreset[];
      const partySize = getRestaurantPartySize(ticket) ?? 2;
      const preference = getRestaurantSeatingPreference(ticket);
      return restaurantTablePresets
        .filter((table) => {
          const meetsSize =
            (!table.minPartySize || partySize >= table.minPartySize) &&
            (!table.maxPartySize || partySize <= table.maxPartySize);
          const preferenceMatches =
            !preference ||
            preference === 'First available' ||
            !table.zone ||
            restaurantAreas.find((area) => area.id === table.zone)?.label.toLowerCase().includes(preference.toLowerCase()) ||
            table.zone.toLowerCase().includes(preference.toLowerCase());
          return meetsSize && preferenceMatches;
        })
        .slice(0, 4);
    },
    [getRestaurantPartySize, getRestaurantSeatingPreference, isRestaurantMode, restaurantAreas, restaurantTablePresets]
  );
  const currentAssignedRestaurantTable =
    tableState.find((table) => table.current_ticket_id === currentTicket?.id) ??
    tableState.find((table) => table.code === currentAssignedTableCode) ??
    null;
  const suggestedTables = getSuggestedTablesForTicket(currentTicket);
  const nextSuggestedTable = suggestedTables[0] ?? null;
  const currentTableCardLabel = currentAssignedRestaurantTable
    ? 'Assigned table'
    : isServing
      ? 'Seat this party at'
      : 'Next table';
  const availableRestaurantTables = tableState.filter(
    (table) => table.status === 'available' && table.current_ticket_id == null
  );
  const occupiedRestaurantTables = tableState.filter(
    (table) => table.status !== 'available' && table.current_ticket_id
  );
  const getTicketById = useCallback(
    (ticketId: string | null | undefined) => {
      if (!ticketId) return null;
      const allTickets = [
        ...(currentTicket ? [currentTicket] : []),
        ...queue.waiting,
        ...queue.called,
        ...queue.serving,
        ...queue.recentlyServed,
        ...queue.cancelled,
      ];
      return allTickets.find((ticket) => ticket.id === ticketId) ?? null;
    },
    [currentTicket, queue]
  );
  const getRestaurantTableStatusTone = useCallback((status: string | null | undefined) => {
    switch (status) {
      case 'occupied':
        return 'bg-rose-100 text-rose-700 border-rose-200';
      case 'held':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'cleaning':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'reserved_soon':
        return 'bg-violet-100 text-violet-700 border-violet-200';
      default:
        return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    }
  }, []);

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {desk.display_name ?? desk.name}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Operator: {staffName}
          </p>
          <p className="mt-2 text-sm font-medium text-foreground/80">{queueStateLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-primary">
              {queue.waiting.length} {isRestaurantMode ? 'parties waiting' : 'waiting'}
            </span>
          </div>
          <div className="hidden items-center gap-2 rounded-full bg-muted px-4 py-2 text-sm font-medium text-muted-foreground md:flex">
            <TimerReset className="h-4 w-4" />
            Longest wait {longestWaitingMinutes}m
          </div>
          {isRestaurantMode && tableState.length > 0 && (
            <button
              type="button"
              onClick={() => setShowTableMapModal(true)}
              className="hidden items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors md:flex"
            >
              <LayoutGrid className="h-4 w-4" />
              Floor Map
              <span className="rounded-full bg-emerald-200 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                {availableRestaurantTables.length}/{tableState.length}
              </span>
            </button>
          )}
          <div
            className={`h-3 w-3 rounded-full ${
              isServing
                ? 'bg-success animate-pulse'
                : isCalled
                  ? 'bg-warning animate-pulse'
                  : 'bg-muted-foreground'
            }`}
            title={isServing ? 'Serving' : isCalled ? 'Called' : 'Idle'}
          />
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Left Column: Current Work Item */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          {/* Current Ticket Card */}
          <div
            className={`rounded-2xl border-2 p-6 transition-all ${
              isServing
                ? 'border-success/40 bg-success/5'
                : isCalled
                  ? 'border-warning/40 bg-warning/5 animate-[pulse_2s_ease-in-out_3]'
                  : 'border-border bg-card'
            }`}
          >
            {isIdle ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                {lastAction ? (
                  <>
                    <div className={`rounded-full p-5 mb-4 ${
                      lastAction.action === 'served' ? 'bg-success/10' :
                      lastAction.action === 'no_show' ? 'bg-warning/10' :
                      lastAction.action === 'cancelled' ? 'bg-destructive/10' :
                      'bg-muted'
                    }`}>
                      {lastAction.action === 'served' ? (
                        <CheckCircle2 className="h-8 w-8 text-success" />
                      ) : lastAction.action === 'no_show' ? (
                        <UserX className="h-8 w-8 text-warning" />
                      ) : lastAction.action === 'cancelled' ? (
                        <AlertCircle className="h-8 w-8 text-destructive" />
                      ) : lastAction.action === 'transferred' ? (
                        <ArrowRightLeft className="h-8 w-8 text-primary" />
                      ) : (
                        <Ticket className="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>
                    <h2 className="text-xl font-semibold text-foreground mb-1">
                      {lastAction.action === 'served' ? 'Visit Complete' :
                       lastAction.action === 'no_show' ? 'Marked No-Show' :
                       lastAction.action === 'cancelled' ? 'Customer Left Queue' :
                       lastAction.action === 'transferred' ? 'Ticket Transferred' :
                       'Ticket Reset'}
                    </h2>
                    <p className="text-sm text-muted-foreground mb-1">
                      Ticket <span className="font-bold text-foreground">{lastAction.ticketNumber}</span>
                      {lastAction.action === 'served' ? ' was served by you' :
                       lastAction.action === 'no_show' ? ' did not show up' :
                       lastAction.action === 'cancelled' ? ' ended their visit' :
                       lastAction.action === 'transferred' ? ' was transferred' :
                       ' was sent back to queue'}
                    </p>
                    <p className="text-xs text-muted-foreground mb-6">
                      {lastAction.time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="rounded-full bg-muted p-6 mb-4">
                      <Ticket className="h-10 w-10 text-muted-foreground" />
                    </div>
                    <h2 className="text-xl font-semibold text-foreground mb-1">
                      {isRestaurantMode ? 'No Active Party' : isClinicMode ? 'No Active Patient' : isBarbershopMode ? 'No Active Client' : isBankMode ? 'No Active Client' : 'No Active Ticket'}
                    </h2>
                    <p className="text-sm text-muted-foreground mb-6">
                      {queue.waiting.length > 0
                        ? isRestaurantMode
                          ? `${queue.waiting.length} party${queue.waiting.length > 1 ? 'ies' : ''} waiting to be seated`
                          : isClinicMode
                            ? `${queue.waiting.length} patient${queue.waiting.length > 1 ? 's' : ''} in the waiting room`
                            : isBarbershopMode
                              ? `${queue.waiting.length} client${queue.waiting.length > 1 ? 's' : ''} waiting`
                              : isBankMode
                                ? `${queue.waiting.length} client${queue.waiting.length > 1 ? 's' : ''} in queue`
                                : `${queue.waiting.length} ticket${queue.waiting.length > 1 ? 's' : ''} waiting in queue`
                        : isRestaurantMode
                          ? 'Waitlist is empty'
                          : isClinicMode
                            ? 'No patients waiting'
                            : isBarbershopMode
                              ? 'No clients waiting'
                              : isBankMode
                                ? 'No clients in queue'
                                : 'Queue is empty'}
                    </p>
                  </>
                )}
                <button
                  onClick={handleCallNext}
                  disabled={isPending || queue.waiting.length === 0 || !canCallNext}
                  className="inline-flex items-center gap-3 rounded-xl bg-primary px-8 py-4 text-lg font-bold text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 active:translate-y-0"
                >
                  {isPending ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <PhoneForwarded className="h-6 w-6" />
                  )}
                  {queue.waiting.length > 0
                    ? isRestaurantMode
                      ? `Notify Next Party (${queue.waiting.length})`
                      : isClinicMode
                        ? `Call Next Patient (${queue.waiting.length})`
                        : isBarbershopMode
                          ? `Call Next Client (${queue.waiting.length})`
                          : `Call Next (${queue.waiting.length})`
                    : isRestaurantMode
                      ? 'Notify Next Party'
                      : isClinicMode
                        ? 'Call Next Patient'
                        : isBarbershopMode
                          ? 'Call Next Client'
                          : 'Call Next'}
                </button>
              </div>
            ) : (
              <div>
                {/* Status Badge + Timer */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                        isServing
                          ? 'bg-success/15 text-success'
                          : 'bg-warning/15 text-warning'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isServing ? 'bg-success' : 'bg-warning'
                        }`}
                      />
                      {isRestaurantMode ? (isServing ? 'Seated' : 'Notified') : isServing ? 'Serving' : 'Called'}
                    </span>
                    <PriorityBadge priorityCategory={getPriorityCategory(currentTicket)} />
                  </div>
                  {isServing && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span
                        className={`font-mono text-lg font-bold ${
                          timer.minutes >= 10 ? 'text-destructive' : 'text-foreground'
                        }`}
                      >
                        {timer.formatted}
                      </span>
                    </div>
                  )}
                  {isCalled && (
                    <div
                      className={`flex items-center gap-2 rounded-full px-4 py-1.5 ${
                        callCountdown <= 10
                          ? 'bg-destructive/15'
                          : callCountdown <= 30
                            ? 'bg-warning/15'
                            : 'bg-muted'
                      } ${callCountdown <= 10 ? 'animate-pulse' : ''}`}
                    >
                      <Clock className={`h-5 w-5 ${
                        callCountdown <= 10 ? 'text-destructive' : callCountdown <= 30 ? 'text-warning' : 'text-muted-foreground'
                      }`} />
                      <span
                        className={`font-mono text-2xl font-black tabular-nums ${
                          callCountdown <= 10
                            ? 'text-destructive'
                            : callCountdown <= 30
                              ? 'text-warning'
                              : 'text-foreground'
                        }`}
                      >
                        0:{callCountdown.toString().padStart(2, '0')}
                      </span>
                      {callCountdown === 0 && (
                        <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-white">EXPIRED</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Ticket Number - Large and prominent */}
                <div className="text-center mb-5">
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">
                    {isRestaurantMode ? `${customerLabel} ready to seat` : 'Ticket Number'}
                  </p>
                  <p className="text-6xl font-black text-foreground tracking-tight leading-none">
                    {isRestaurantMode
                      ? getTicketCustomerName(currentTicket) ?? currentTicket.ticket_number
                      : currentTicket.ticket_number}
                  </p>
                  {isRestaurantMode && (
                    <p className="mt-2 text-base font-semibold text-muted-foreground">
                      Ref {currentTicket.ticket_number}
                    </p>
                  )}
                </div>

                <div className="mb-5 grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {isRestaurantMode ? serviceLabel : 'Service'}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {isRestaurantMode && currentPartySize ? `Party of ${currentPartySize}` : currentServiceName}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {isRestaurantMode ? 'Arrival' : 'Source'}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{getTicketSource(currentTicket)}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {isRestaurantMode ? currentTableCardLabel : 'Checked in'}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {isRestaurantMode
                        ? currentAssignedRestaurantTable
                          ? `${currentAssignedRestaurantTable.code} · ${currentAssignedRestaurantTable.label}`
                          : nextSuggestedTable
                            ? `${nextSuggestedTable.code} · ${nextSuggestedTable.label}`
                            : 'Choose table'
                        : formatAbsoluteTime(currentTicket.checked_in_at)}
                    </p>
                    {isRestaurantMode && currentPreference && (
                      <p className="mt-1 text-xs text-muted-foreground">{currentPreference}</p>
                    )}
                  </div>
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {isRestaurantMode
                        ? currentReservationReference
                          ? 'Reservation ref'
                          : isServing
                            ? 'Seated at'
                            : 'Notified at'
                        : isServing
                          ? 'Started serving'
                          : 'Called at'}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {isRestaurantMode && currentReservationReference
                        ? currentReservationReference
                        : isServing
                          ? formatAbsoluteTime(currentTicket.serving_started_at)
                          : formatAbsoluteTime(currentTicket.called_at)}
                    </p>
                  </div>
                </div>

                {isRestaurantMode && currentNeeds.length > 0 && (
                  <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">Needs</span>
                    <span className="text-sm font-semibold text-foreground">{currentNeeds.join(' · ')}</span>
                  </div>
                )}

                {isRestaurantMode && (
                  <div className="mb-5">
                    {currentAssignedRestaurantTable ? (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-200/60 text-sm font-black text-emerald-800">
                            {currentAssignedRestaurantTable.code}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground">{currentAssignedRestaurantTable.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {restaurantAreas.find((area) => area.id === currentAssignedRestaurantTable.zone)?.label ??
                                (currentAssignedRestaurantTable.zone
                                  ? toTitleCase(currentAssignedRestaurantTable.zone.replace(/-/g, ' '))
                                  : 'Dining room')}
                              {currentAssignedRestaurantTable.capacity ? ` · Seats ${currentAssignedRestaurantTable.capacity}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setShowTableMapModal(true)}
                            className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-foreground hover:bg-emerald-100"
                          >
                            Change
                          </button>
                          <button
                            type="button"
                            onClick={() => handleClearRestaurantTable(currentAssignedRestaurantTable)}
                            disabled={isPending}
                            className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-foreground hover:bg-emerald-100 disabled:opacity-50"
                          >
                            Unassign
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3">
                        <p className="text-sm text-muted-foreground">No table assigned</p>
                        <button
                          type="button"
                          onClick={() => setShowTableMapModal(true)}
                          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90"
                        >
                          <LayoutGrid className="h-4 w-4" />
                          Floor Map
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Customer Data */}
                {!isRestaurantMode && (
                  currentTicket.customer_data ? (
                    <CustomerDataCard
                      data={currentTicket.customer_data as Record<string, unknown> | null}
                      fields={currentTicketFields}
                      scope={customerDataScope}
                      className="mb-5"
                    />
                  ) : (
                    <div className="mb-5 grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Customer</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">
                          {getTicketCustomerName(currentTicket) ?? 'No intake collected'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Department</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">
                          {getTicketDepartmentName(currentTicket)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Estimated wait</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">
                          {currentTicket.estimated_wait_minutes ? `${currentTicket.estimated_wait_minutes} min` : 'Not available'}
                        </p>
                      </div>
                    </div>
                  )
                )}

                {/* Clinic-specific appointment info */}
                {isClinicMode && currentTicket && (
                  <div className="mb-5 rounded-xl border border-teal-200 bg-teal-50/50 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm font-semibold text-teal-800">Patient Visit Details</span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-700/70">Visit Type</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">{getTicketServiceName(currentTicket)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-700/70">Source</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">{currentTicket.appointment_id ? 'Scheduled appointment' : 'Walk-in visit'}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-700/70">Wait Time</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">{formatRelativeTime(currentTicket.created_at)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Barbershop-specific service info */}
                {isBarbershopMode && currentTicket && (
                  <div className="mb-5 rounded-xl border border-violet-200 bg-violet-50/50 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm font-semibold text-violet-800">Service Details</span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-700/70">Service</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">{getTicketServiceName(currentTicket)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-700/70">Type</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">{currentTicket.appointment_id ? 'Booked' : 'Walk-in'}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-700/70">Waiting Since</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">{formatRelativeTime(currentTicket.created_at)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Bank-specific counter info */}
                {isBankMode && currentTicket && (
                  <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm font-semibold text-blue-800">Counter Service Details</span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700/70">Transaction</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">{getTicketServiceName(currentTicket)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700/70">Channel</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">{currentTicket.appointment_id ? 'Pre-booked' : currentTicket.is_remote ? 'Mobile queue' : 'Walk-in'}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700/70">Queue Time</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">{formatRelativeTime(currentTicket.created_at)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-3">
                  {isCalled && (
                    <>
                      <button
                        onClick={handleStartServing}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-success px-5 py-3 text-sm font-bold text-success-foreground shadow-md hover:bg-success/90 disabled:opacity-50 transition-all"
                      >
                        {isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                        {isRestaurantMode
                          ? currentAssignedTableCode
                            ? 'Seat Party'
                            : 'Choose Table to Seat'
                          : isClinicMode
                            ? 'Begin Consultation'
                            : isBarbershopMode
                              ? 'Start Service'
                              : isBankMode
                                ? 'Begin Service'
                                : 'Start Serving'}
                      </button>
                      <button
                        onClick={handleRecall}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-5 py-3 text-sm font-bold text-primary hover:bg-primary/20 disabled:opacity-50 transition-all"
                      >
                        <Volume2 className="h-4 w-4" />
                        {isRestaurantMode ? 'Notify Again' : 'Recall'}
                      </button>
                      <button
                        onClick={handleBuzz}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-destructive/10 px-5 py-3 text-sm font-bold text-destructive hover:bg-destructive/20 disabled:opacity-50 transition-all"
                      >
                        <Smartphone className="h-4 w-4" />
                        {isRestaurantMode ? 'Send Ready Alert' : 'Buzz'}
                      </button>
                      <button
                        onClick={handleNoShow}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-warning/10 px-5 py-3 text-sm font-bold text-warning hover:bg-warning/20 disabled:opacity-50 transition-all"
                      >
                        <UserX className="h-4 w-4" />
                        {isRestaurantMode ? 'Party Left' : isClinicMode ? 'Patient Left' : isBarbershopMode ? 'Client Left' : 'No Show'}
                      </button>
                      <button
                        onClick={handleResetToQueue}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-gray-100 px-5 py-3 text-sm font-bold text-gray-600 hover:bg-gray-200 disabled:opacity-50 transition-all"
                      >
                        <ArrowRightLeft className="h-4 w-4" />
                        {isRestaurantMode ? 'Back to Waitlist' : isClinicMode ? 'Back to Waiting Room' : 'Reset to Queue'}
                      </button>
                      <button
                        onClick={handleParkTicket}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-amber-100 px-5 py-3 text-sm font-bold text-amber-700 hover:bg-amber-200 disabled:opacity-50 transition-all"
                      >
                        <Pause className="h-4 w-4" />
                        {isRestaurantMode ? 'Park Party' : isClinicMode ? 'Hold Patient' : isBarbershopMode ? 'Hold Client' : 'Park'}
                      </button>
                    </>
                  )}

                  {isServing && (
                    <>
                      <button
                        onClick={handleMarkServed}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-success px-6 py-3 text-sm font-bold text-success-foreground shadow-md hover:bg-success/90 disabled:opacity-50 transition-all"
                      >
                        {isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        {isRestaurantMode ? 'Close Party' : isClinicMode ? 'Complete Visit' : isBarbershopMode ? 'Service Complete' : isBankMode ? 'Transaction Complete' : 'Mark Served'}
                      </button>
                      {!isRestaurantMode && (
                        <button
                          onClick={() => setShowTransferDialog(true)}
                          disabled={isPending}
                          className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-5 py-3 text-sm font-bold text-primary hover:bg-primary/20 disabled:opacity-50 transition-all"
                        >
                          <ArrowRightLeft className="h-4 w-4" />
                          {isClinicMode ? 'Refer to Department' : 'Transfer'}
                        </button>
                      )}
                      <button
                        onClick={handleParkTicket}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-amber-100 px-5 py-3 text-sm font-bold text-amber-700 hover:bg-amber-200 disabled:opacity-50 transition-all"
                      >
                        <Pause className="h-4 w-4" />
                        {isRestaurantMode ? 'Park Party' : isClinicMode ? 'Hold Patient' : isBarbershopMode ? 'Hold Client' : 'Park'}
                      </button>
                    </>
                  )}

                  {/* Put back — dismiss a seated party back to the sidebar */}
                  {isServing && isRestaurantMode && currentAssignedRestaurantTable && (
                    <button
                      onClick={() => setCurrentTicket(null)}
                      className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-bold text-foreground hover:bg-muted transition-all"
                    >
                      <X className="h-4 w-4" />
                      Put back
                    </button>
                  )}

                  {/* Call Next while serving (queue next) — only for multi-call verticals */}
                  {isServing && queue.waiting.length > 0 && allowMultiCall && (
                    <button
                      onClick={handleCallNext}
                      disabled={isPending}
                      className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-bold text-foreground hover:bg-muted disabled:opacity-50 transition-all ml-auto"
                    >
                      <PhoneForwarded className="h-4 w-4" />
                      {isRestaurantMode ? `Notify Next Party (${queue.waiting.length})` : `Call Next (${queue.waiting.length})`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Called Stack - other called tickets at this desk */}
          {calledAtThisDesk.length > 0 && (
            <div className="rounded-2xl border-2 border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {isRestaurantMode ? 'Other Notified Parties' : isClinicMode ? 'Other Called Patients' : 'Other Called Tickets'}
                  <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                    {calledAtThisDesk.length}
                  </span>
                </h3>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {calledAtThisDesk.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="flex-shrink-0 w-56 rounded-xl border border-primary/20 bg-card p-3"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-base font-bold text-foreground">
                        {isRestaurantMode ? getTicketCustomerName(ticket) ?? ticket.ticket_number : ticket.ticket_number}
                      </span>
                      <PriorityBadge priorityCategory={getPriorityCategory(ticket)} />
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {isRestaurantMode
                        ? `${getRestaurantPartySize(ticket) ? `Party of ${getRestaurantPartySize(ticket)}` : getTicketServiceName(ticket)}`
                        : getTicketServiceName(ticket)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Called {formatRelativeTime(ticket.called_at)}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleResumeTicket(ticket)}
                        disabled={isPending}
                        className="flex-1 rounded-lg bg-primary px-2 py-1.5 text-[11px] font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        Switch to
                      </button>
                      <button
                        type="button"
                        onClick={() => handleParkSpecificTicket(ticket)}
                        disabled={isPending}
                        className="rounded-lg bg-amber-100 px-2 py-1.5 text-[11px] font-bold text-amber-700 hover:bg-amber-200 disabled:opacity-50"
                      >
                        <Pause className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Queue Health */}
          <div className={`grid gap-4 ${parkedTickets.length > 0 ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {isRestaurantMode ? 'Parties waiting' : 'Waiting'}
              </p>
              <p className="mt-2 text-3xl font-bold text-foreground">{queue.waiting.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Longest wait</p>
              <p className="mt-2 text-3xl font-bold text-foreground">{longestWaitingMinutes}m</p>
            </div>
            {parkedTickets.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">On hold</p>
                <p className="mt-2 text-3xl font-bold text-amber-700">{parkedTickets.length}</p>
              </div>
            )}
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active elsewhere</p>
              <p className="mt-2 text-3xl font-bold text-foreground">{activeElsewhere.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recently served</p>
              <p className="mt-2 text-3xl font-bold text-foreground">{queue.recentlyServed.length}</p>
            </div>
          </div>
        </div>

        {/* Right Column: Queue List */}
        <div className="flex flex-col gap-4 min-h-0">
          {/* Waiting Queue */}
          <div className="rounded-2xl border border-border bg-card flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {queueLabel}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {isRestaurantMode
                    ? `Next parties waiting for this ${deskLabel.toLowerCase()}'s area`
                    : isClinicMode
                      ? 'Patients waiting to be seen'
                      : isBarbershopMode
                        ? 'Clients waiting for service'
                        : `Next people waiting for this ${deskLabel.toLowerCase()}'s department`}
                </p>
              </div>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                {queue.waiting.length}
              </span>
            </div>
            <div className="border-b border-border px-4 py-3">
              {nextWaitingTicket ? (
                <div className="rounded-xl bg-primary/5 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Up next</p>
                      <div className="mt-1 flex items-center gap-2">
                        <p className="text-lg font-bold text-foreground">{nextWaitingTicket.ticket_number}</p>
                        <PriorityBadge priorityCategory={getPriorityCategory(nextWaitingTicket)} />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCallWaitingTicket(nextWaitingTicket)}
                      disabled={isPending || !canCallNext}
                      className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {isRestaurantMode ? 'Notify now' : 'Call now'}
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isRestaurantMode
                      ? `${getTicketCustomerName(nextWaitingTicket) ?? 'Walk-in party'} · ${
                          getRestaurantPartySize(nextWaitingTicket)
                            ? `Party of ${getRestaurantPartySize(nextWaitingTicket)}`
                          : normalizeRestaurantLabel(getTicketServiceName(nextWaitingTicket)) ?? getTicketServiceName(nextWaitingTicket)
                        } · ${formatRelativeTime(nextWaitingTicket.created_at)}`
                      : `${getTicketServiceName(nextWaitingTicket)} · ${formatRelativeTime(nextWaitingTicket.created_at)}`}
                  </p>
                  {isRestaurantMode && getSuggestedTablesForTicket(nextWaitingTicket)[0] && (
                    <p className="mt-2 text-xs font-semibold text-foreground">
                      Next table: {getSuggestedTablesForTicket(nextWaitingTicket)[0]?.code} · {getSuggestedTablesForTicket(nextWaitingTicket)[0]?.label}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {isRestaurantMode ? 'No parties are waiting right now.' : 'No one is waiting right now.'}
                </p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : queue.waiting.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
                  <Ticket className="mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">
                    {isRestaurantMode ? 'No parties waiting' : 'No tickets waiting'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isRestaurantMode
                      ? 'When new walk-ins or reservations arrive, they will appear here in waitlist order.'
                      : 'When new arrivals check in, they will appear here in queue order.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {queue.waiting.slice(1).map((ticket, index) => (
                    (() => {
                      const rowSuggestedTable = isRestaurantMode ? getSuggestedTablesForTicket(ticket)[0] : null;
                      return (
                        <div
                          key={ticket.id}
                          className="rounded-xl border border-border px-3 py-3 transition-colors hover:bg-muted/30"
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                              {index + 1}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-bold text-foreground">
                                      {ticket.ticket_number}
                                    </p>
                                    <PriorityBadge priorityCategory={getPriorityCategory(ticket)} className="shrink-0" />
                                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                      {getTicketSource(ticket)}
                                    </span>
                                    {rowSuggestedTable && (
                                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                                        {rowSuggestedTable.code}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleCallWaitingTicket(ticket)}
                                  disabled={isPending || !canCallNext}
                                  className="shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-[11px] font-bold text-foreground hover:bg-muted disabled:opacity-50"
                                >
                                  {isRestaurantMode ? 'Notify' : 'Call'}
                                </button>
                              </div>
                              <p className="mt-1 text-sm text-foreground/80">
                                {isRestaurantMode
                                  ? `${getTicketCustomerName(ticket) ?? 'Walk-in party'}${
                                      getRestaurantPartySize(ticket) ? ` · Party of ${getRestaurantPartySize(ticket)}` : ''
                                    }`
                                  : getTicketServiceName(ticket)}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                <span>
                                  {isRestaurantMode
                                    ? getRestaurantSeatingPreference(ticket) ?? 'First available'
                                    : getTicketCustomerName(ticket) ?? 'No name provided'}
                                </span>
                                <span>{formatRelativeTime(ticket.created_at)}</span>
                                <span>Checked in {formatAbsoluteTime(ticket.checked_in_at)}</span>
                                {isRestaurantMode && rowSuggestedTable && (
                                  <span>Next table {rowSuggestedTable.code}</span>
                                )}
                                {isRestaurantMode && getReservationReference(ticket) && (
                                  <span>{getReservationReference(ticket)}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* On Hold / Parked Tickets */}
          {parkedTickets.length > 0 && (
            <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/50">
              <div className="border-b border-amber-200 px-4 py-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-amber-800">
                    {isRestaurantMode ? 'Parked Parties' : isClinicMode ? 'On Hold Patients' : isBarbershopMode ? 'On Hold Clients' : 'On Hold'}
                  </h3>
                  <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                    {parkedTickets.length}
                  </span>
                </div>
                <p className="text-xs text-amber-700/70 mt-0.5">
                  {isRestaurantMode
                    ? 'Parked parties waiting to be resumed'
                    : 'Tickets paused and waiting to be resumed'}
                </p>
              </div>
              <div className="p-2 space-y-2">
                {parkedTickets.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="rounded-xl border border-amber-200 bg-white px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-foreground">
                            {isRestaurantMode ? getTicketCustomerName(ticket) ?? ticket.ticket_number : ticket.ticket_number}
                          </span>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            ticket.status === 'serving' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                          }`}>
                            {ticket.status === 'serving' ? 'Was serving' : 'Was called'}
                          </span>
                          <PriorityBadge priorityCategory={getPriorityCategory(ticket)} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground truncate">
                          {isRestaurantMode
                            ? `${getRestaurantPartySize(ticket) ? `Party of ${getRestaurantPartySize(ticket)} · ` : ''}${getTicketServiceName(ticket)}`
                            : `${getTicketCustomerName(ticket) ?? 'No name'} · ${getTicketServiceName(ticket)}`}
                        </p>
                        <p className="mt-1 text-xs text-amber-600">
                          <Pause className="inline h-3 w-3 mr-0.5" />
                          Parked {formatRelativeTime(ticket.parked_at)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnparkTicket(ticket)}
                        disabled={isPending}
                        className="shrink-0 rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        Resume
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Parties — unified section for seated tables + other active tickets */}
          <div className="rounded-2xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  {isRestaurantMode ? 'Active Parties' : isClinicMode ? 'Active Patients' : isBarbershopMode ? 'Active Clients' : 'Active Tickets'}
                </h3>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">
                  {isRestaurantMode
                    ? occupiedRestaurantTables.length + activeElsewhere.length
                    : activeElsewhere.length}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isRestaurantMode
                  ? 'Seated parties and active tickets across all stands'
                  : isClinicMode
                    ? 'Patients currently being seen across all rooms'
                    : 'All currently called or serving tickets'}
              </p>
            </div>
            <div className="p-2 space-y-1 max-h-72 overflow-y-auto">
              {/* Restaurant: Seated at tables (this desk's tables) */}
              {isRestaurantMode && occupiedRestaurantTables.length > 0 && (
                <>
                  <p className="px-2 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                    Seated at tables
                  </p>
                  {occupiedRestaurantTables.map((table) => {
                    const seatedTicket = getTicketById(table.current_ticket_id);
                    const zoneLabel =
                      restaurantAreas.find((area) => area.id === table.zone)?.label ??
                      (table.zone ? toTitleCase(table.zone.replace(/-/g, ' ')) : 'Dining room');
                    const seatedName = getTicketCustomerName(seatedTicket) ?? 'Unknown party';
                    const partySize = getRestaurantPartySize(seatedTicket);

                    return (
                      <div
                        key={table.id}
                        className="rounded-xl border border-border px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-rose-100 text-[11px] font-black text-rose-700 shrink-0">
                              {table.code}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground truncate">
                                {seatedName}{partySize ? ` · ${partySize}` : ''}
                              </p>
                              <p className="text-[11px] text-muted-foreground truncate">
                                {zoneLabel}{table.assigned_at ? ` · ${formatRelativeTime(table.assigned_at)}` : ''}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {seatedTicket && currentTicket?.id !== seatedTicket.id && (
                              <button
                                type="button"
                                onClick={() => handleResumeTicket(seatedTicket)}
                                disabled={isPending}
                                className="rounded-lg border border-border px-2 py-1.5 text-[10px] font-bold text-foreground hover:bg-muted disabled:opacity-50"
                              >
                                View
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleClearRestaurantTable(table)}
                              disabled={isPending}
                              className="rounded-lg border border-border px-2 py-1.5 text-[10px] font-bold text-foreground hover:bg-muted disabled:opacity-50"
                            >
                              Free table
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {/* Other active tickets (at other desks) */}
              {activeElsewhere.length > 0 && (
                <>
                  {isRestaurantMode && occupiedRestaurantTables.length > 0 && (
                    <p className="px-2 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                      At other {deskLabel.toLowerCase()}s
                    </p>
                  )}
                  {activeElsewhere.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="rounded-xl border border-border px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full flex-shrink-0 ${
                            ticket.status === 'serving' ? 'bg-success' : 'bg-warning'
                          }`}
                        />
                        <span className="text-sm font-semibold text-foreground truncate">
                          {isRestaurantMode
                            ? getTicketCustomerName(ticket) ?? ticket.ticket_number
                            : ticket.ticket_number}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground ml-auto shrink-0">
                          {isRestaurantMode
                            ? ticket.status === 'serving' ? 'Seated' : 'Notified'
                            : ticket.status}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>
                          {isRestaurantMode
                            ? getRestaurantPartySize(ticket) ? `Party of ${getRestaurantPartySize(ticket)}` : getTicketServiceName(ticket)
                            : `${getTicketCustomerName(ticket) ?? 'No name'} · ${getTicketServiceName(ticket)}`}
                        </span>
                        <span>{formatRelativeTime(ticket.called_at ?? ticket.serving_started_at)}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Empty state */}
              {(isRestaurantMode ? occupiedRestaurantTables.length + activeElsewhere.length : activeElsewhere.length) === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {isRestaurantMode
                    ? 'No parties are currently seated or being served.'
                    : isClinicMode
                      ? 'No patients are currently being seen.'
                      : 'No tickets are currently being served.'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Transfer Dialog */}
      {showTransferDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <ArrowRightLeft className="h-5 w-5 text-primary" />
                  {isRestaurantMode ? 'Move Party' : 'Transfer Ticket'}
                </h3>
              <button
                onClick={() => {
                  setShowTransferDialog(false);
                  setTransferDeptId('');
                  setTransferServiceId('');
                }}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">
                  {isRestaurantMode ? 'Move party' : 'Transferring ticket'}{' '}
                  <span className="font-bold text-foreground">
                    {currentTicket?.ticket_number}
                  </span>
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  {isRestaurantMode ? 'Seating area' : 'Department'}
                </label>
                <select
                  value={transferDeptId}
                  onChange={(e) => {
                    setTransferDeptId(e.target.value);
                    setTransferServiceId('');
                  }}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                    <option value="">{isRestaurantMode ? 'Select seating area...' : 'Select department...'}</option>
                  {departments
                    .filter((d) => d.is_active && d.id !== desk.department_id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </div>
              {transferDeptId && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                  {isRestaurantMode ? serviceLabel : 'Service'}
                  </label>
                  <select
                    value={transferServiceId}
                    onChange={(e) => setTransferServiceId(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                    <option value="">{isRestaurantMode ? `Select ${serviceLabel.toLowerCase()}...` : 'Select service...'}</option>
                    {transferableServices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setShowTransferDialog(false);
                    setTransferDeptId('');
                    setTransferServiceId('');
                  }}
                  className="flex-1 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleTransfer}
                  disabled={!transferDeptId || !transferServiceId || isPending}
                  className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Transferring...
                    </span>
                  ) : (
                    isRestaurantMode ? 'Move Party' : 'Transfer'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table Map Modal */}
      {showTableMapModal && isRestaurantMode && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/50">
          <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-card border border-border shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <LayoutGrid className="h-5 w-5 text-primary" />
                  Floor Map
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {availableRestaurantTables.length} available · {occupiedRestaurantTables.length} occupied · {tableState.length} total
                </p>
              </div>
              <button
                onClick={() => {
                  setShowTableMapModal(false);
                  setTableMapFilter('all');
                  setTableMapZoneFilter(null);
                }}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Filter Bar */}
            <div className="border-b border-border px-6 py-3 flex flex-wrap items-center gap-2">
              {(['all', 'available', 'occupied'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setTableMapFilter(filter)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    tableMapFilter === filter
                      ? filter === 'available'
                        ? 'bg-emerald-600 text-white'
                        : filter === 'occupied'
                          ? 'bg-rose-600 text-white'
                          : 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {filter === 'all' ? `All (${tableState.length})` : filter === 'available' ? `Available (${availableRestaurantTables.length})` : `Occupied (${occupiedRestaurantTables.length})`}
                </button>
              ))}
              <div className="h-4 w-px bg-border mx-1" />
              <button
                type="button"
                onClick={() => setTableMapZoneFilter(null)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  tableMapZoneFilter === null ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                All zones
              </button>
              {restaurantAreas.map((area) => (
                <button
                  key={area.id}
                  type="button"
                  onClick={() => setTableMapZoneFilter(tableMapZoneFilter === area.id ? null : area.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    tableMapZoneFilter === area.id ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {area.label}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {(() => {
                const filteredTables = tableState.filter((table) => {
                  if (tableMapFilter === 'available' && (table.status !== 'available' || table.current_ticket_id != null)) return false;
                  if (tableMapFilter === 'occupied' && (table.status === 'available' && table.current_ticket_id == null)) return false;
                  if (tableMapZoneFilter && table.zone !== tableMapZoneFilter) return false;
                  return true;
                });

                // Group by zone
                const zones = new Map<string, typeof filteredTables>();
                for (const table of filteredTables) {
                  const zoneKey = table.zone ?? '__general__';
                  if (!zones.has(zoneKey)) zones.set(zoneKey, []);
                  zones.get(zoneKey)!.push(table);
                }

                if (filteredTables.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <LayoutGrid className="h-10 w-10 text-muted-foreground mb-3" />
                      <p className="text-sm font-medium text-foreground">No tables match this filter</p>
                      <p className="text-xs text-muted-foreground mt-1">Try a different filter or zone.</p>
                    </div>
                  );
                }

                return Array.from(zones.entries()).map(([zoneKey, tables]) => {
                  const zoneLabel = zoneKey === '__general__'
                    ? (restaurantAreas.length > 0 ? 'General' : '')
                    : restaurantAreas.find((a) => a.id === zoneKey)?.label ?? toTitleCase(zoneKey.replace(/-/g, ' '));

                  return (
                    <div key={zoneKey} className="mb-6 last:mb-0">
                      {zoneLabel && (
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">{zoneLabel}</h4>
                      )}
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {tables.map((table) => {
                          const isAvailable = table.status === 'available' && table.current_ticket_id == null;
                          const isOccupied = !isAvailable && table.current_ticket_id != null;
                          const seatedTicket = isOccupied ? getTicketById(table.current_ticket_id) : null;
                          const isRecommended = currentTicket && suggestedTables.some((s) => s.code === table.code);

                          return (
                            <button
                              key={table.id}
                              type="button"
                              onClick={() => {
                                if (isAvailable && currentTicket) {
                                  handleAssignRestaurantTable(table);
                                  setShowTableMapModal(false);
                                  setTableMapFilter('all');
                                  setTableMapZoneFilter(null);
                                }
                              }}
                              disabled={!isAvailable || !currentTicket || isPending}
                              className={`relative rounded-xl border-2 p-3 text-left transition-all ${
                                isAvailable
                                  ? isRecommended
                                    ? 'border-primary bg-emerald-50 ring-2 ring-primary hover:bg-emerald-100 cursor-pointer'
                                    : 'border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100 cursor-pointer'
                                  : table.status === 'held' || table.status === 'reserved_soon'
                                    ? 'border-amber-200 bg-amber-50/70 cursor-default'
                                    : 'border-rose-200 bg-rose-50/70 cursor-default'
                              } ${(!isAvailable || !currentTicket) ? 'opacity-80' : ''}`}
                            >
                              <div className="flex items-center justify-between gap-1 mb-1">
                                <span className="text-lg font-black text-foreground leading-tight">{table.code}</span>
                                <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${
                                  isAvailable ? 'bg-emerald-500' : table.status === 'held' || table.status === 'reserved_soon' ? 'bg-amber-500' : 'bg-rose-500'
                                }`} />
                              </div>
                              <p className="text-[11px] text-muted-foreground truncate">{table.label}</p>
                              {table.capacity && (
                                <p className="text-[10px] text-muted-foreground">Seats {table.capacity}</p>
                              )}
                              {isOccupied && seatedTicket && (
                                <p className="mt-1 text-[10px] font-semibold text-rose-600 truncate">
                                  {getTicketCustomerName(seatedTicket) ?? seatedTicket.ticket_number}
                                </p>
                              )}
                              {isRecommended && (
                                <span className="absolute -top-1.5 -right-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold text-primary-foreground">
                                  Best fit
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 rounded-xl px-5 py-3 shadow-lg text-sm font-medium animate-[slideIn_0.3s_ease-out] ${
              toast.type === 'success'
                ? 'bg-success text-success-foreground'
                : toast.type === 'error'
                  ? 'bg-destructive text-destructive-foreground'
                  : 'bg-primary text-primary-foreground'
            }`}
          >
            {toast.type === 'success' && <CheckCircle2 className="h-4 w-4 flex-shrink-0" />}
            {toast.type === 'error' && <AlertCircle className="h-4 w-4 flex-shrink-0" />}
            {toast.type === 'info' && <ChevronRight className="h-4 w-4 flex-shrink-0" />}
            {toast.message}
            <button
              onClick={() => removeToast(toast.id)}
              className="ml-2 opacity-70 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
