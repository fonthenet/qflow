'use client';

import { useState, useTransition, useEffect } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Lock, Unlock, X } from 'lucide-react';
import {
  getBlockedSlots,
  createBlockedSlot,
  deleteBlockedSlot,
} from '@/lib/actions/blocked-slot-actions';

interface Office {
  id: string;
  name: string;
  operating_hours?: Record<string, { open: string; close: string }> | null;
}

interface BlockedSlot {
  id: string;
  office_id: string;
  blocked_date: string;
  start_time: string;
  end_time: string;
  reason: string | null;
  created_at: string;
}

interface SlotManagerProps {
  offices: Office[];
  orgSettings: Record<string, any>;
}

function generateSlots(openTime: string, closeTime: string, durationMinutes: number): string[] {
  const slots: string[] = [];
  const [openH, openM] = openTime.split(':').map(Number);
  const [closeH, closeM] = closeTime.split(':').map(Number);
  let h = openH, m = openM;
  while (h < closeH || (h === closeH && m < closeM)) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += durationMinutes;
    if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
  }
  return slots;
}

function formatTime12(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  let totalMin = h * 60 + m + minutes;
  const newH = Math.floor(totalMin / 60) % 24;
  const newM = totalMin % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function SlotManager({ offices, orgSettings }: SlotManagerProps) {
  const slotDuration = Number(orgSettings.slot_duration_minutes ?? 30);
  const activeOffices = offices.filter((o) => (o as any).is_active !== false);
  const [selectedOfficeId, setSelectedOfficeId] = useState(activeOffices[0]?.id ?? '');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Block dialog
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [blockStartTime, setBlockStartTime] = useState('');
  const [blockEndTime, setBlockEndTime] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedOffice = activeOffices.find((o) => o.id === selectedOfficeId);

  // Load blocked slots when office or date changes
  useEffect(() => {
    if (!selectedOfficeId || !selectedDate) return;
    setLoading(true);
    getBlockedSlots(selectedOfficeId, selectedDate)
      .then((result) => {
        if (result.data) setBlockedSlots(result.data as BlockedSlot[]);
      })
      .finally(() => setLoading(false));
  }, [selectedOfficeId, selectedDate]);

  // Generate time slots for the selected office and day
  const operatingHours = selectedOffice?.operating_hours ?? {};
  const dayOfWeek = new Date(selectedDate + 'T12:00:00')
    .toLocaleDateString('en-US', { weekday: 'long' })
    .toLowerCase();
  const dayHours = operatingHours[dayOfWeek] ?? { open: '08:00', close: '17:00' };
  const allSlots = generateSlots(dayHours.open, dayHours.close, slotDuration);

  function isSlotBlocked(slotTime: string): BlockedSlot | undefined {
    return blockedSlots.find((b) => slotTime >= b.start_time && slotTime < b.end_time);
  }

  function navigateDate(delta: number) {
    const d = new Date(selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setSelectedDate(d.toISOString().split('T')[0]);
  }

  function openBlockDialog(slotTime: string) {
    setBlockStartTime(slotTime);
    setBlockEndTime(addMinutes(slotTime, slotDuration));
    setBlockReason('');
    setError(null);
    setShowBlockDialog(true);
  }

  function handleBlock() {
    setError(null);
    startTransition(async () => {
      const result = await createBlockedSlot({
        officeId: selectedOfficeId,
        blockedDate: selectedDate,
        startTime: blockStartTime,
        endTime: blockEndTime,
        reason: blockReason || undefined,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setShowBlockDialog(false);
        setSuccess('Slot blocked successfully');
        setTimeout(() => setSuccess(null), 3000);
        // Refresh
        const refreshed = await getBlockedSlots(selectedOfficeId, selectedDate);
        if (refreshed.data) setBlockedSlots(refreshed.data as BlockedSlot[]);
      }
    });
  }

  function handleUnblock(slotId: string) {
    startTransition(async () => {
      const result = await deleteBlockedSlot(slotId);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess('Slot unblocked');
        setTimeout(() => setSuccess(null), 3000);
        const refreshed = await getBlockedSlots(selectedOfficeId, selectedDate);
        if (refreshed.data) setBlockedSlots(refreshed.data as BlockedSlot[]);
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {activeOffices.length > 1 && (
          <select
            value={selectedOfficeId}
            onChange={(e) => setSelectedOfficeId(e.target.value)}
            className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
          >
            {activeOffices.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-1">
          <button
            onClick={() => navigateDate(-1)}
            className="rounded-lg p-1.5 hover:bg-muted transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
            <span className="text-sm font-medium text-foreground">{formatDate(selectedDate)}</span>
          </div>
          <button
            onClick={() => navigateDate(1)}
            className="rounded-lg p-1.5 hover:bg-muted transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <span className="text-xs text-muted-foreground">
          {dayHours.open} - {dayHours.close} &middot; {slotDuration}min slots
        </span>
      </div>

      {/* Messages */}
      {success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
          {success}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Slot Grid */}
      {loading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading slots...</div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {allSlots.map((slot) => {
            const blocked = isSlotBlocked(slot);
            return (
              <div
                key={slot}
                className={`group relative rounded-xl border p-3 transition-colors ${
                  blocked
                    ? 'border-rose-200 bg-rose-50'
                    : 'border-border bg-background hover:border-primary/30 hover:bg-primary/5 cursor-pointer'
                }`}
                onClick={() => {
                  if (blocked) return;
                  openBlockDialog(slot);
                }}
              >
                <div className="text-sm font-medium text-foreground">{formatTime12(slot)}</div>
                {blocked ? (
                  <div className="mt-1">
                    <div className="flex items-center gap-1 text-xs text-rose-600">
                      <Lock className="h-3 w-3" />
                      Blocked
                    </div>
                    {blocked.reason && (
                      <p className="mt-0.5 text-[11px] text-rose-500 truncate" title={blocked.reason}>
                        {blocked.reason}
                      </p>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUnblock(blocked.id);
                      }}
                      disabled={isPending}
                      className="mt-1.5 flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-100 transition-colors disabled:opacity-50"
                    >
                      <Unlock className="h-3 w-3" />
                      Unblock
                    </button>
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                    Click to block
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {allSlots.length === 0 && !loading && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No operating hours configured for this day.
        </div>
      )}

      {/* Block Dialog (Modal) */}
      {showBlockDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-foreground">Block Time Slot</h3>
              <button
                onClick={() => setShowBlockDialog(false)}
                className="rounded-lg p-1 hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={blockStartTime}
                    onChange={(e) => setBlockStartTime(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={blockEndTime}
                    onChange={(e) => setBlockEndTime(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Reason (optional)
                </label>
                <input
                  type="text"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="e.g. Lunch break, Staff meeting..."
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowBlockDialog(false)}
                  className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBlock}
                  disabled={isPending || !blockStartTime || !blockEndTime}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-rose-700 disabled:opacity-50 transition-colors"
                >
                  {isPending ? 'Blocking...' : 'Block Slot'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
