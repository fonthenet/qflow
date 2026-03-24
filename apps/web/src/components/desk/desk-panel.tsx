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
} from '@/lib/actions/ticket-actions';
import { CustomerDataCard } from '@/components/desk/customer-data-card';
import { PriorityBadge } from '@/components/tickets/priority-badge';
import { useI18n } from '@/components/providers/locale-provider';
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
  initialDisplayMode?: 'normal' | 'minimal';
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
  initialDisplayMode = 'normal',
}: DeskPanelProps) {
  const { t } = useI18n();
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
  const [showTableAssignmentPanel, setShowTableAssignmentPanel] = useState(false);
  const [transferDeptId, setTransferDeptId] = useState('');
  const [transferServiceId, setTransferServiceId] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [displayMode, setDisplayMode] = useState<'normal' | 'minimal'>(initialDisplayMode);
  const [isPending, startTransition] = useTransition();
  const toastIdRef = useRef(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const { queue: liveQueue, isLoading } = useRealtimeQueue({
    officeId: desk.office_id,
    departmentId: desk.department_id,
    disabled: sandboxMode,
    initialQueue: sandbox?.initialQueue,
  });
  const queue = sandboxMode ? sandboxQueue : liveQueue;
  const isMinimalView = displayMode === 'minimal';
  const hasActiveDeskTicket = Boolean(
    currentTicket && (currentTicket.status === 'called' || currentTicket.status === 'serving')
  );

  useEffect(() => {
    const storageKey = `qf_desk_display_mode:${desk.id}`;
    const saved =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(storageKey)
        : null;
    if (saved === 'normal' || saved === 'minimal') {
      setDisplayMode(saved);
      return;
    }
    setDisplayMode(initialDisplayMode);
  }, [desk.id, initialDisplayMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(`qf_desk_display_mode:${desk.id}`, displayMode);
  }, [desk.id, displayMode]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setTableState(restaurantTables);
  }, [restaurantTables]);
  useEffect(() => {
    setShowTableAssignmentPanel(false);
  }, [currentTicket?.id]);
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
  const customerLabel = vocabulary?.customerLabel ?? 'Customer';
  const queueLabel = vocabulary?.queueLabel ?? 'Queue';
  const serviceLabel = vocabulary?.serviceLabel ?? 'Service';
  const deskLabel = vocabulary?.deskLabel ?? 'Desk';
  const bookingLabel = vocabulary?.bookingLabel ?? 'Booking';

  const timer = useServiceTimer(
    currentTicket?.status === 'serving'
      ? currentTicket.serving_started_at ?? currentTicket.called_at
      : null
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

  const getDeskErrorMessage = useCallback(
    (message: string) => {
      const normalized = message.trim().toLowerCase();
      if (normalized.includes('desk already has an active ticket')) {
        return t('This {label} already has an active ticket. Finish service or send the current ticket back to the queue first.', {
          label: deskLabel.toLowerCase(),
        });
      }
      return message;
    },
    [deskLabel, t]
  );

  const handleCallNext = () => {
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
        addToast(getDeskErrorMessage(result.error), 'error');
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
      setShowTableAssignmentPanel(true);
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
        addToast(getDeskErrorMessage(result.error), 'error');
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
        addToast(getDeskErrorMessage(result.error), 'error');
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
        addToast(getDeskErrorMessage(result.error), 'error');
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
        addToast(getDeskErrorMessage(result.error), 'error');
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
        addToast(getDeskErrorMessage(result.error), 'error');
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
    resetSpecificTicketToQueue(currentTicket);
  };

  const resetSpecificTicketToQueue = (ticket: Ticket) => {
    if (sandboxMode) {
      const resetTicket = {
        ...ticket,
        status: 'waiting' as const,
        called_at: null,
        serving_started_at: null,
        desk_id: null,
      };
      setSandboxQueue((current) => ({
        ...current,
        called: current.called.filter((entry) => entry.id !== ticket.id),
        serving: current.serving.filter((entry) => entry.id !== ticket.id),
        waiting: [...current.waiting, resetTicket],
      }));
      setTableState((current) =>
        current.map((table) =>
          table.current_ticket_id === ticket.id
            ? { ...table, status: 'available', current_ticket_id: null, assigned_at: null }
            : table
        )
      );
      setLastAction({ ticketNumber: ticket.ticket_number, action: 'reset', time: new Date() });
      setCurrentTicket((current) => (current?.id === ticket.id ? null : current));
      addToast(isRestaurantMode ? 'Party sent back to waitlist' : 'Ticket reset to queue', 'info');
      return;
    }
    startTransition(async () => {
      const result = await resetTicketToQueue(ticket.id);
      if (result.error) {
        addToast(getDeskErrorMessage(result.error), 'error');
        return;
      }
      setLastAction({ ticketNumber: ticket.ticket_number, action: 'reset', time: new Date() });
      setCurrentTicket((current) => (current?.id === ticket.id ? null : current));
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
        addToast(getDeskErrorMessage(result.error), 'error');
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
      setShowTableAssignmentPanel(false);
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
        addToast(getDeskErrorMessage(result.error), 'error');
        return;
      }
      setCurrentTicket(result.data);
      setShowTableAssignmentPanel(false);
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
    setShowTableAssignmentPanel(false);
    addToast(
      isRestaurantMode
        ? `Resumed ${getTicketCustomerName(ticket) ?? 'party'} on the host stand`
        : `Resumed ticket ${ticket.ticket_number}`,
      'info'
    );
  };

  const handleCallWaitingTicket = (ticket: Ticket) => {
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
        addToast(getDeskErrorMessage(result.error), 'error');
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
      setCurrentTicket(updatedTicket);
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
      setShowTableAssignmentPanel(false);
      addToast(`Assigned ${table.code} to ${getTicketCustomerName(updatedTicket) ?? 'party'}`);
      return;
    }

    startTransition(async () => {
      const result = await assignRestaurantTable(currentTicket.id, table.id);
      if (result.error) {
        addToast(getDeskErrorMessage(result.error), 'error');
        return;
      }
      if (!result.data) {
        addToast('Table assignment did not return updated data', 'error');
        return;
      }
      setCurrentTicket(result.data.ticket);
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
      setShowTableAssignmentPanel(false);
      addToast(`Assigned ${result.data.table.code} to ${getTicketCustomerName(result.data.ticket) ?? 'party'}`);
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
    if (asBoolean(data.accessibility_seating)) items.push(t('Accessible seating'));
    if (asBoolean(data.high_chair)) items.push(t('High chair'));
    return items;
  }, [t]);

  const getTicketSource = useCallback((ticket: Ticket | null | undefined) => {
    if (!ticket) return t('Unknown');
    if (ticket.appointment_id) return isRestaurantMode ? bookingLabel : t('Appointment');
    if (ticket.is_remote) return isRestaurantMode ? t('Remote waitlist') : t('Remote join');
    return isRestaurantMode ? t('Walk-in party') : t('Walk-in');
  }, [bookingLabel, isRestaurantMode, t]);

  const formatAbsoluteTime = useCallback((value: string | null | undefined) => {
    if (!value) return '--';
    return new Date(value).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  }, []);

  const formatRelativeTime = useCallback((value: string | null | undefined) => {
    if (!value) return '--';
    const elapsedMinutes = Math.max(0, Math.floor((nowMs - new Date(value).getTime()) / 60000));
    if (elapsedMinutes < 1) return t('Just now');
    if (elapsedMinutes === 1) return t('1 min ago');
    if (elapsedMinutes < 60) return t('{count} min ago', { count: elapsedMinutes });
    const hours = Math.floor(elapsedMinutes / 60);
    const minutes = elapsedMinutes % 60;
    return minutes === 0
      ? t('{count}h ago', { count: hours })
      : t('{hours}h {minutes}m ago', { hours, minutes });
  }, [nowMs, t]);

  const getWaitingAnchor = useCallback(
    (ticket: Ticket | null | undefined) => ticket?.checked_in_at ?? ticket?.created_at ?? null,
    []
  );

  const formatWaitMinutes = useCallback(
    (minutes: number) => (minutes > 0 ? t('{count} min', { count: minutes }) : t('Just now')),
    [t]
  );

  const waitingTickets = queue.waiting;
  const activeElsewhere = [...queue.called, ...queue.serving].filter((ticket) => ticket.id !== currentTicket?.id);
  const nextWaitingTicket = waitingTickets[0] ?? null;
  const longestWaitingMinutes = waitingTickets.reduce((longest, ticket) => {
    const anchor = getWaitingAnchor(ticket);
    if (!anchor) return longest;
    const elapsed = Math.max(0, Math.floor((nowMs - new Date(anchor).getTime()) / 60000));
    return Math.max(longest, elapsed);
  }, 0);
  const queueStateLabel = isRestaurantMode
    ? isServing
      ? t('Party seated now')
      : isCalled
        ? t('Waiting for party to arrive')
        : t('Ready to notify the next party')
    : isServing
      ? t('Serving now')
      : isCalled
        ? t('Waiting for customer')
        : t('Ready for next ticket');
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
    ? t('Assigned table')
    : isServing
      ? t('Seat this party at')
      : t('Next table');
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {desk.display_name ?? desk.name}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('Operator')}: {staffName}
          </p>
          <p className="mt-2 text-sm font-medium text-foreground/80">{queueStateLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center rounded-full border border-border bg-card p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setDisplayMode('normal')}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                displayMode === 'normal'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {t('Normal')}
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('minimal')}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                displayMode === 'minimal'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {t('Minimal')}
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-primary">
              {isRestaurantMode
                ? t('{count} parties waiting', { count: queue.waiting.length })
                : t('{count} waiting', { count: queue.waiting.length })}
            </span>
          </div>
          <div className={`items-center gap-2 rounded-full bg-muted px-4 py-2 text-sm font-medium text-muted-foreground md:flex ${isMinimalView ? 'hidden' : 'hidden md:flex'}`}>
            <TimerReset className="h-4 w-4" />
            {t('Longest wait')}: {formatWaitMinutes(longestWaitingMinutes)}
          </div>
          <div
            className={`h-3 w-3 rounded-full ${
              isServing
                ? 'bg-success animate-pulse'
                : isCalled
                  ? 'bg-warning animate-pulse'
                  : 'bg-muted-foreground'
            }`}
            title={isServing ? t('Serving') : isCalled ? t('Called') : t('Idle')}
          />
        </div>
      </div>

      {/* Main Content Grid */}
      <div className={`grid grid-cols-1 gap-6 flex-1 min-h-0 ${isMinimalView ? 'lg:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.95fr)]' : 'lg:grid-cols-3'}`}>
        {/* Left Column: Current Work Item */}
        <div className={`${isMinimalView ? '' : 'lg:col-span-2'} flex flex-col gap-5`}>
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
                      {lastAction.action === 'served' ? t('Visit Complete') :
                       lastAction.action === 'no_show' ? t('Marked No-Show') :
                       lastAction.action === 'cancelled' ? t('Customer Left Queue') :
                       lastAction.action === 'transferred' ? t('Ticket Transferred') :
                       t('Ticket Reset')}
                    </h2>
                    <p className="text-sm text-muted-foreground mb-1">
                      {t('Ticket')} <span className="font-bold text-foreground">{lastAction.ticketNumber}</span>
                      {lastAction.action === 'served' ? t(' was served by you') :
                       lastAction.action === 'no_show' ? t(' did not show up') :
                       lastAction.action === 'cancelled' ? t(' ended their visit') :
                       lastAction.action === 'transferred' ? t(' was transferred') :
                       t(' was sent back to queue')}
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
                      {isRestaurantMode ? t('No Active Party') : t('No Active Ticket')}
                    </h2>
                    <p className="text-sm text-muted-foreground mb-6">
                      {queue.waiting.length > 0
                        ? isRestaurantMode
                          ? t('{count} parties waiting to be seated', { count: queue.waiting.length })
                          : t('{count} tickets waiting in queue', { count: queue.waiting.length })
                        : isRestaurantMode
                          ? t('Waitlist is empty')
                          : t('Queue is empty')}
                    </p>
                  </>
                )}
                <button
                  onClick={handleCallNext}
                  disabled={isPending || queue.waiting.length === 0}
                  className="inline-flex items-center gap-3 rounded-xl bg-primary px-8 py-4 text-lg font-bold text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 active:translate-y-0"
                >
                  {isPending ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <PhoneForwarded className="h-6 w-6" />
                  )}
                  {queue.waiting.length > 0
                    ? isRestaurantMode
                      ? t('Notify Next Party ({count})', { count: queue.waiting.length })
                      : t('Call Next ({count})', { count: queue.waiting.length })
                    : isRestaurantMode
                      ? t('Notify Next Party')
                      : t('Call Next')}
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
                      {isRestaurantMode ? (isServing ? t('Seated') : t('Notified')) : isServing ? t('Serving') : t('Called')}
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
                        <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-white">{t('EXPIRED')}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Ticket Number - Large and prominent */}
                <div className="text-center mb-5">
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">
                    {isRestaurantMode ? t('{label} ready to seat', { label: customerLabel }) : t('Ticket Number')}
                  </p>
                  <p className="text-6xl font-black text-foreground tracking-tight leading-none">
                    {isRestaurantMode
                      ? getTicketCustomerName(currentTicket) ?? currentTicket.ticket_number
                      : currentTicket.ticket_number}
                  </p>
                  {isRestaurantMode && (
                    <p className="mt-2 text-base font-semibold text-muted-foreground">
                      {t('Ref')} {currentTicket.ticket_number}
                    </p>
                  )}
                  {(!isRestaurantMode || isMinimalView) && (
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                      {!isRestaurantMode && (
                        <span className="rounded-full bg-background px-3 py-1 text-sm font-medium text-foreground shadow-sm">
                          {getTicketCustomerName(currentTicket) ?? t('No name provided')}
                        </span>
                      )}
                      <span className="rounded-full bg-background px-3 py-1 text-sm font-medium text-foreground shadow-sm">
                        {t('Checked in')} {formatAbsoluteTime(currentTicket.checked_in_at)}
                      </span>
                    </div>
                  )}
                </div>

                {!isMinimalView && (
                <div className="mb-5 grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {isRestaurantMode ? serviceLabel : t('Service')}
                      
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {isRestaurantMode && currentPartySize ? t('Party of {count}', { count: currentPartySize }) : currentServiceName}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {isRestaurantMode ? t('Arrival') : t('Source')}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{getTicketSource(currentTicket)}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {isRestaurantMode ? currentTableCardLabel : t('Checked in')}
                      
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {isRestaurantMode
                        ? currentAssignedRestaurantTable
                          ? `${currentAssignedRestaurantTable.code} · ${currentAssignedRestaurantTable.label}`
                        : nextSuggestedTable
                            ? `${nextSuggestedTable.code} · ${nextSuggestedTable.label}`
                            : t('Choose table')
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
                          ? t('Reservation ref')
                          : isServing
                            ? t('Seated at')
                            : t('Notified at')
                        : isServing
                          ? t('Started serving')
                          : t('Called at')}
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
                )}

                {!isMinimalView && isRestaurantMode && (
                  <div className="mb-5 grid gap-3 lg:grid-cols-[1.35fr_0.95fr]">
                    <div className="rounded-xl border border-border bg-card">
                      <div className="border-b border-border px-4 py-3">
                        <h3 className="text-sm font-semibold text-foreground">{t('Party details')}</h3>
                      </div>
                      <div className="grid gap-3 p-4 md:grid-cols-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{customerLabel}</p>
                          <p className="mt-1 text-sm font-semibold text-foreground">{getTicketCustomerName(currentTicket) ?? t('Walk-in party')}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('Party size')}</p>
                          <p className="mt-1 text-sm font-semibold text-foreground">{currentPartySize ? t('{count} guests', { count: currentPartySize }) : t('Not collected')}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('Checked in')}</p>
                          <p className="mt-1 text-sm font-semibold text-foreground">{formatAbsoluteTime(currentTicket.checked_in_at)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('Assigned table')}</p>
                          <p className="mt-1 text-sm font-semibold text-foreground">
                            {currentAssignedRestaurantTable
                              ? `${currentAssignedRestaurantTable.code} · ${currentAssignedRestaurantTable.label}`
                              : currentAssignedTableCode
                                ? `${currentAssignedTableCode} · ${currentAssignedTableLabel ?? t('Assigned')}`
                              : t('Not assigned yet')}
                          </p>
                        </div>
                        <div className="md:col-span-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('Needs')}</p>
                          <p className="mt-1 text-sm font-semibold text-foreground">{currentNeeds.length > 0 ? currentNeeds.join(' · ') : t('No special seating needs')}</p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-card">
                      <div className="border-b border-border px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold text-foreground">
                              {currentAssignedRestaurantTable ? t('Change table') : t('Available tables')}
                            </h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {currentAssignedRestaurantTable
                                ? t('This party already has a table. Change it only if the host needs to move them.')
                                : showTableAssignmentPanel
                                  ? t('Pick a table to seat the current party.')
                                  : t('Open seating options when you are ready to assign a table.')}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowTableAssignmentPanel((current) => !current)}
                            className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted"
                          >
                            {showTableAssignmentPanel
                              ? t('Hide')
                              : currentAssignedRestaurantTable
                                ? t('Change table')
                                : t('Choose table')}
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2 p-4">
                        {currentAssignedRestaurantTable && (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                                  Assigned table
                                </p>
                                <p className="mt-1 text-lg font-bold text-foreground">
                                  {currentAssignedRestaurantTable.code}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {currentAssignedRestaurantTable.label}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                  <span>
                                    {restaurantAreas.find((area) => area.id === currentAssignedRestaurantTable.zone)?.label ??
                                      (currentAssignedRestaurantTable.zone
                                        ? toTitleCase(currentAssignedRestaurantTable.zone.replace(/-/g, ' '))
                                        : 'Dining room')}
                                  </span>
                                  {currentAssignedRestaurantTable.capacity ? (
                                    <span>Seats up to {currentAssignedRestaurantTable.capacity}</span>
                                  ) : null}
                                  {currentAssignedRestaurantTable.assigned_at ? (
                                    <span>Selected {formatRelativeTime(currentAssignedRestaurantTable.assigned_at)}</span>
                                  ) : null}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleClearRestaurantTable(currentAssignedRestaurantTable)}
                                disabled={isPending}
                                className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-foreground hover:bg-emerald-100 disabled:opacity-50"
                              >
                                Unassign table
                              </button>
                            </div>
                          </div>
                        )}
                        {showTableAssignmentPanel && nextSuggestedTable && (
                          <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Seat this party next at</p>
                            <div className="mt-1 flex items-center justify-between gap-3">
                              <div>
                                <p className="text-lg font-bold text-foreground">{nextSuggestedTable.code}</p>
                                <p className="text-sm text-muted-foreground">{nextSuggestedTable.label}</p>
                              </div>
                              <span className="rounded-full bg-card px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm">
                                {restaurantAreas.find((area) => area.id === nextSuggestedTable.zone)?.label ??
                                  (nextSuggestedTable.zone ? toTitleCase(nextSuggestedTable.zone.replace(/-/g, ' ')) : 'Dining room')}
                              </span>
                            </div>
                          </div>
                        )}
                        {showTableAssignmentPanel ? (
                          availableRestaurantTables.length > 0 ? (
                          availableRestaurantTables.map((table) => {
                            const zoneLabel =
                              restaurantAreas.find((area) => area.id === table.zone)?.label ??
                              (table.zone ? toTitleCase(table.zone.replace(/-/g, ' ')) : 'Dining room');
                            const isRecommended = suggestedTables.some(
                              (suggested) => suggested.code === table.code
                            );
                            return (
                              <div key={table.code} className={`rounded-xl border bg-background px-3 py-3 ${isRecommended ? 'border-primary/30' : 'border-border'}`}>
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-bold text-foreground">{table.label}</p>
                                    <p className="text-xs text-muted-foreground">{zoneLabel} · Seats up to {table.capacity ?? table.max_party_size ?? 0}</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {isRecommended && (
                                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                                        Best fit
                                      </span>
                                    )}
                                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                                      {table.code}
                                    </span>
                                  </div>
                                </div>
                                <div className="mt-3 flex items-center justify-between gap-3">
                                  <span
                                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getRestaurantTableStatusTone(table.status)}`}
                                  >
                                    {table.status === 'available' ? 'Available now' : toTitleCase(table.status ?? 'available')}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleAssignRestaurantTable(table)}
                                    disabled={isPending}
                                    className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                  >
                                    Assign
                                  </button>
                                </div>
                              </div>
                            );
                          })
                          ) : (
                          <p className="text-sm text-muted-foreground">No available tables right now. Free up or turn a table before seating the next party.</p>
                          )
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {currentAssignedRestaurantTable ? (
                              <>This party is already assigned to <span className="font-semibold text-foreground">{currentAssignedRestaurantTable.code}</span>. Use <span className="font-semibold text-foreground">Change table</span> only if you need to move them.</>
                            ) : (
                              <>Click <span className="font-semibold text-foreground">Choose table</span> when the host is ready to seat this party.</>
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Customer Data */}
                {!isMinimalView && !isRestaurantMode && currentTicket.customer_data ? (
                  <CustomerDataCard
                    data={currentTicket.customer_data as Record<string, unknown> | null}
                    fields={currentTicketFields}
                    scope={customerDataScope}
                    className="mb-5"
                  />
                ) : !isMinimalView ? (
                  <div className="mb-5 grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {isRestaurantMode ? t('Party') : customerLabel}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground">
                        {getTicketCustomerName(currentTicket) ?? (isRestaurantMode ? t('Walk-in party') : t('No intake collected'))}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {isRestaurantMode ? t('Area') : t('Department')}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground">
                        {isRestaurantMode
                          ? currentPreference ?? getTicketDepartmentName(currentTicket)
                          : getTicketDepartmentName(currentTicket)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {isRestaurantMode ? t('Wait quote') : t('Estimated wait')}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-foreground">
                        {currentTicket.estimated_wait_minutes
                          ? formatWaitMinutes(currentTicket.estimated_wait_minutes)
                          : t('Not available')}
                      </p>
                    </div>
                  </div>
                ) : null}

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
                            ? t('Seat Party')
                            : t('Choose Table to Seat')
                          : t('Start Serving')}
                      </button>
                      <button
                        onClick={handleRecall}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-5 py-3 text-sm font-bold text-primary hover:bg-primary/20 disabled:opacity-50 transition-all"
                      >
                        <Volume2 className="h-4 w-4" />
                        {isRestaurantMode ? t('Notify Again') : t('Recall')}
                      </button>
                      <button
                        onClick={handleBuzz}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-destructive/10 px-5 py-3 text-sm font-bold text-destructive hover:bg-destructive/20 disabled:opacity-50 transition-all"
                      >
                        <Smartphone className="h-4 w-4" />
                        {isRestaurantMode ? t('Send Ready Alert') : t('Buzz')}
                      </button>
                      <button
                        onClick={handleNoShow}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-warning/10 px-5 py-3 text-sm font-bold text-warning hover:bg-warning/20 disabled:opacity-50 transition-all"
                      >
                        <UserX className="h-4 w-4" />
                        {isRestaurantMode ? t('Party Left') : t('No Show')}
                      </button>
                      <button
                        onClick={handleResetToQueue}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-gray-100 px-5 py-3 text-sm font-bold text-gray-600 hover:bg-gray-200 disabled:opacity-50 transition-all"
                      >
                        <ArrowRightLeft className="h-4 w-4" />
                        {isRestaurantMode ? t('Back to Waitlist') : t('Reset to Queue')}
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
                        {isRestaurantMode ? t('Close Party') : t('Mark Served')}
                      </button>
                      <button
                        onClick={() => setShowTransferDialog(true)}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-5 py-3 text-sm font-bold text-primary hover:bg-primary/20 disabled:opacity-50 transition-all"
                      >
                        <ArrowRightLeft className="h-4 w-4" />
                        {isRestaurantMode ? t('Reassign Area') : t('Transfer')}
                      </button>
                    </>
                  )}

                  {/* Call Next while serving (queue next) */}
                  {isServing && queue.waiting.length > 0 && (
                    <button
                      onClick={handleCallNext}
                      disabled={isPending}
                      className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-bold text-foreground hover:bg-muted disabled:opacity-50 transition-all ml-auto"
                    >
                  <PhoneForwarded className="h-4 w-4" />
                      {isRestaurantMode
                        ? t('Notify Next Party ({count})', { count: queue.waiting.length })
                        : t('Call Next ({count})', { count: queue.waiting.length })}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Queue Health */}
          {!isMinimalView && (
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {isRestaurantMode ? t('Parties waiting') : t('Waiting')}
              </p>
              <p className="mt-2 text-3xl font-bold text-foreground">{queue.waiting.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('Longest wait')}</p>
              
              <p className="mt-2 text-3xl font-bold text-foreground">{formatWaitMinutes(longestWaitingMinutes)}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('Active elsewhere')}</p>
              <p className="mt-2 text-3xl font-bold text-foreground">{activeElsewhere.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('Recently served')}</p>
              <p className="mt-2 text-3xl font-bold text-foreground">{queue.recentlyServed.length}</p>
            </div>
          </div>
          )}
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
                    ? t('Next parties waiting for this {label}\'s area', { label: deskLabel.toLowerCase() })
                    : t('Next people waiting for this {label}\'s department', { label: deskLabel.toLowerCase() })}
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
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">{t('Up next')}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-foreground shadow-sm">
                          {nextWaitingTicket.ticket_number}
                        </span>
                        <span className="rounded-full bg-white/80 px-3 py-1 text-sm font-medium text-foreground/80 shadow-sm">
                          {getTicketCustomerName(nextWaitingTicket) ?? (isRestaurantMode ? t('Walk-in party') : t('No name provided'))}
                        </span>
                        <PriorityBadge priorityCategory={getPriorityCategory(nextWaitingTicket)} />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCallWaitingTicket(nextWaitingTicket)}
                      disabled={isPending || hasActiveDeskTicket}
                      title={hasActiveDeskTicket ? t('Finish service or send the current ticket back to the queue first.') : undefined}
                      className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:hover:bg-muted disabled:opacity-100"
                    >
                      {isRestaurantMode ? t('Notify now') : t('Call now')}
                    </button>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isRestaurantMode
                      ? `${getTicketCustomerName(nextWaitingTicket) ?? t('Walk-in party')} · ${
                          getRestaurantPartySize(nextWaitingTicket)
                            ? t('Party of {count}', { count: getRestaurantPartySize(nextWaitingTicket) })
                          : normalizeRestaurantLabel(getTicketServiceName(nextWaitingTicket)) ?? getTicketServiceName(nextWaitingTicket)
                        } · ${formatRelativeTime(nextWaitingTicket.created_at)}`
                      : `${getTicketServiceName(nextWaitingTicket)} · ${formatRelativeTime(nextWaitingTicket.created_at)}`}
                  </p>
                  {isRestaurantMode && getSuggestedTablesForTicket(nextWaitingTicket)[0] && (
                    <p className="mt-2 text-xs font-semibold text-foreground">
                      {t('Next table')}: {getSuggestedTablesForTicket(nextWaitingTicket)[0]?.code} · {getSuggestedTablesForTicket(nextWaitingTicket)[0]?.label}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {isRestaurantMode ? t('No parties are waiting right now.') : t('No one is waiting right now.')}
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
                    {isRestaurantMode ? t('No parties waiting') : t('No tickets waiting')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {isRestaurantMode
                      ? 'When new walk-ins or reservations arrive, they will appear here in waitlist order.'
                      : 'When new arrivals check in, they will appear here in queue order.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {queue.waiting.map((ticket, index) => (
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
                                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-sm font-bold text-foreground">
                                      {ticket.ticket_number}
                                    </span>
                                    <span className="rounded-full bg-primary/5 px-2.5 py-1 text-sm font-medium text-foreground/80">
                                      {getTicketCustomerName(ticket) ?? (isRestaurantMode ? t('Walk-in party') : t('No name provided'))}
                                    </span>
                                    <PriorityBadge priorityCategory={getPriorityCategory(ticket)} className="shrink-0" />
                                    {!isMinimalView && (
                                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                      {getTicketSource(ticket)}
                                    </span>
                                    )}
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
                                  disabled={isPending || hasActiveDeskTicket}
                                  title={hasActiveDeskTicket ? t('Finish service or send the current ticket back to the queue first.') : undefined}
                                  className="shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-[11px] font-bold text-foreground hover:bg-muted disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:hover:bg-muted disabled:opacity-100"
                                >
                                  {isRestaurantMode ? t('Notify') : t('Call')}
                                </button>
                              </div>
                              <p className="mt-1 text-sm text-foreground/80">
                                {isRestaurantMode
                                  ? `${getTicketCustomerName(ticket) ?? t('Walk-in party')}${
                                      getRestaurantPartySize(ticket) ? ` · ${t('Party of {count}', { count: getRestaurantPartySize(ticket) })}` : ''
                                    }`
                                  : getTicketServiceName(ticket)}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                <span>
                                  {isRestaurantMode
                                    ? getRestaurantSeatingPreference(ticket) ?? t('First available')
                                    : getTicketServiceName(ticket)}
                                </span>
                                <span>{formatRelativeTime(ticket.created_at)}</span>
                                <span>{t('Checked in')} {formatAbsoluteTime(ticket.checked_in_at)}</span>
                                {isRestaurantMode && rowSuggestedTable && (
                                  <span>{t('Next table')} {rowSuggestedTable.code}</span>
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

          {!isMinimalView && isRestaurantMode && (
            <div className="rounded-2xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold text-foreground">{t('Taken tables')}</h3>
                <p className="text-xs text-muted-foreground">
                  {t('See which parties are seated now, then clear the table when it is ready again.')}
                </p>
              </div>
              <div className="space-y-2 p-3">
                {occupiedRestaurantTables.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    {t('No tables are currently taken.')}
                  </p>
                ) : (
                  occupiedRestaurantTables.map((table) => {
                    const seatedTicket = getTicketById(table.current_ticket_id);
                    const zoneLabel =
                      restaurantAreas.find((area) => area.id === table.zone)?.label ??
                      (table.zone ? toTitleCase(table.zone.replace(/-/g, ' ')) : t('Dining room'));
                    const seatedName = getTicketCustomerName(seatedTicket) ?? t('Unknown party');
                    const partySize = getRestaurantPartySize(seatedTicket);

                    return (
                      <div
                        key={table.id}
                        className="rounded-xl border border-border bg-background px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-bold text-foreground">{table.code}</p>
                              <span
                                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${getRestaurantTableStatusTone(table.status)}`}
                              >
                                {toTitleCase(table.status ?? 'occupied')}
                              </span>
                            </div>
                            <p className="mt-1 text-sm font-semibold text-foreground">
                              {seatedName}
                              {partySize ? ` · ${t('Party of {count}', { count: partySize })}` : ''}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>{table.label}</span>
                              <span>{zoneLabel}</span>
                              {seatedTicket?.ticket_number ? (
                                <span>{seatedTicket.ticket_number}</span>
                              ) : null}
                              {table.assigned_at ? (
                                <span>{t('Seated')} {formatRelativeTime(table.assigned_at)}</span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col gap-2">
                            {seatedTicket && currentTicket?.id !== seatedTicket.id ? (
                              <button
                                type="button"
                                onClick={() => handleResumeTicket(seatedTicket)}
                                disabled={isPending}
                                className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-bold text-foreground hover:bg-muted disabled:opacity-50"
                              >
                                {t('Resume')}
                              </button>
                            ) : null}
                            {seatedTicket ? (
                              <button
                                type="button"
                                onClick={() => handleBuzzSpecificTicket(seatedTicket)}
                                disabled={isPending}
                                className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-50"
                              >
                                {t('Call back')}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => handleClearRestaurantTable(table)}
                              disabled={isPending}
                              className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-foreground hover:bg-muted disabled:opacity-50"
                            >
                              {t('Clear table')}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Currently Called / Being Served by Others */}
          {!isMinimalView && (
          <div className="rounded-2xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">
                {isRestaurantMode ? t('Active at Other {label}s', { label: deskLabel }) : t('Active at Other Desks')}
              </h3>
              <p className="text-xs text-muted-foreground">
                {isRestaurantMode
                  ? t('See notified or seated parties at other host stands')
                  : t('Cross-desk visibility for called or serving tickets')}
              </p>
            </div>
            <div className="p-2 space-y-1 max-h-56 overflow-y-auto">
              {activeElsewhere.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {isRestaurantMode
                    ? t('No other host stands are actively notifying or seating parties right now.')
                    : t('No other desks are actively calling or serving right now.')}
                </p>
              ) : (
                activeElsewhere.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="rounded-xl border border-border px-3 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`h-2 w-2 rounded-full flex-shrink-0 ${
                          ticket.status === 'serving' ? 'bg-success' : 'bg-warning'
                        }`}
                      />
                      <span className="text-sm font-bold text-foreground">
                        {ticket.ticket_number}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground ml-auto">
                        {ticket.status}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {isRestaurantMode
                          ? `${getTicketCustomerName(ticket) ?? t('Party')}${
                              getRestaurantPartySize(ticket) ? ` · ${t('Party of {count}', { count: getRestaurantPartySize(ticket) })}` : ''
                            }`
                          : getTicketServiceName(ticket)}
                      </span>
                      <span>{getTicketSource(ticket)}</span>
                      {isRestaurantMode && getRestaurantSeatingPreference(ticket) && (
                        <span>{getRestaurantSeatingPreference(ticket)}</span>
                      )}
                      <span>{formatRelativeTime(ticket.called_at ?? ticket.serving_started_at)}</span>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => resetSpecificTicketToQueue(ticket)}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs font-bold text-warning hover:bg-warning/20 disabled:opacity-50"
                      >
                        <TimerReset className="h-3.5 w-3.5" />
                        {isRestaurantMode ? t('Back to Waitlist') : t('Reset to Queue')}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Transfer Dialog */}
      {showTransferDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <ArrowRightLeft className="h-5 w-5 text-primary" />
                  {isRestaurantMode ? t('Move Party') : t('Transfer Ticket')}
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
                  {isRestaurantMode ? t('Move party') : t('Transferring ticket')}{' '}
                  <span className="font-bold text-foreground">
                    {currentTicket?.ticket_number}
                  </span>
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  {isRestaurantMode ? t('Seating area') : t('Department')}
                </label>
                <select
                  value={transferDeptId}
                  onChange={(e) => {
                    setTransferDeptId(e.target.value);
                    setTransferServiceId('');
                  }}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                    <option value="">{isRestaurantMode ? t('Select seating area...') : t('Select department...')}</option>
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
                  {isRestaurantMode ? serviceLabel : t('Service')}
                  </label>
                  <select
                    value={transferServiceId}
                    onChange={(e) => setTransferServiceId(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                    <option value="">{isRestaurantMode ? t('Select {label}...', { label: serviceLabel.toLowerCase() }) : t('Select service...')}</option>
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
                  {t('Cancel')}
                </button>
                <button
                  onClick={handleTransfer}
                  disabled={!transferDeptId || !transferServiceId || isPending}
                  className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('Transferring...')}
                    </span>
                  ) : (
                    isRestaurantMode ? t('Move Party') : t('Transfer')
                  )}
                </button>
              </div>
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
