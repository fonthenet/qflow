'use client';

import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { nanoid } from 'nanoid';
import QRCode from 'qrcode';
import { createPublicTicket } from '@/lib/actions/public-ticket-actions';

interface PriorityCategory {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  weight: number | null;
}

interface GroupMember {
  id: string;
  name: string;
  serviceId: string;
  serviceName: string;
}

interface GroupTicketModalProps {
  office: any;
  organization: any;
  department: any;
  priorityCategories: PriorityCategory[];
  onClose: () => void;
  onComplete: (tickets: any[], qrDataUrl: string) => void;
}

export function GroupTicketModal({
  office,
  organization,
  department,
  priorityCategories,
  onClose,
  onComplete,
}: GroupTicketModalProps) {
  const activeServices = (department.services ?? [])
    .filter((s: any) => s.is_active)
    .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));

  const [members, setMembers] = useState<GroupMember[]>([
    {
      id: nanoid(6),
      name: '',
      serviceId: activeServices[0]?.id ?? '',
      serviceName: activeServices[0]?.name ?? '',
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [selectedPriority, setSelectedPriority] = useState<PriorityCategory | null>(null);

  function addMember() {
    setMembers((prev) => [
      ...prev,
      {
        id: nanoid(6),
        name: '',
        serviceId: activeServices[0]?.id ?? '',
        serviceName: activeServices[0]?.name ?? '',
      },
    ]);
  }

  function removeMember(id: string) {
    if (members.length <= 1) return;
    setMembers((prev) => prev.filter((m) => m.id !== id));
  }

  function updateMember(id: string, field: keyof GroupMember, value: string) {
    setMembers((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        if (field === 'serviceId') {
          const svc = activeServices.find((s: any) => s.id === value);
          return { ...m, serviceId: value, serviceName: svc?.name ?? '' };
        }
        return { ...m, [field]: value };
      })
    );
  }

  async function handleSubmit() {
    if (members.length === 0) return;
    if (members.some((m) => !m.serviceId)) {
      alert('Please select a service for each group member.');
      return;
    }

    setLoading(true);
    const groupId = nanoid(16);
    const createdTickets: any[] = [];

    // Use the first ticket's qr_token for the group QR
    let groupQrToken = '';

    for (let i = 0; i < members.length; i++) {
      const member = members[i];
      const result = await createPublicTicket({
        officeId: office.id,
        departmentId: department.id,
        serviceId: member.serviceId,
        checkedInAt: new Date().toISOString(),
        customerData: member.name ? { name: member.name } : null,
        groupId,
        priority: selectedPriority?.weight ?? 0,
        priorityCategoryId: selectedPriority?.id ?? null,
      });

      if (result.error || !result.data) {
        alert(result.error ?? `Error creating ticket for person ${i + 1}. Please try again.`);
        setLoading(false);
        return;
      }
      const newTicket = result.data;

      if (i === 0) {
        groupQrToken = newTicket.qr_token;
      }

      createdTickets.push({
        ...newTicket,
        service_name: member.serviceName,
        person_name: member.name || `Person ${i + 1}`,
      });
    }

    // Generate QR code using the first ticket's token
    const qrUrl = `${window.location.origin}/q/${groupQrToken}`;
    const dataUrl = await QRCode.toDataURL(qrUrl, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });

    setLoading(false);
    onComplete(createdTickets, dataUrl);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">Group Ticket</h2>
            <p className="text-sm text-muted-foreground">
              {department.name} - Create tickets for multiple people
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Group Members */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-foreground">
                Group Members ({members.length})
              </label>
              <button
                type="button"
                onClick={addMember}
                className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Person
              </button>
            </div>

            {members.map((member, index) => (
              <div
                key={member.id}
                className="rounded-lg border border-border bg-muted/30 p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Person {index + 1}
                  </span>
                  {members.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeMember(member.id)}
                      className="rounded p-1 text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={member.name}
                  onChange={(e) => updateMember(member.id, 'name', e.target.value)}
                  placeholder="Name (optional)"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
                <select
                  value={member.serviceId}
                  onChange={(e) => updateMember(member.id, 'serviceId', e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  {activeServices.map((service: any) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Priority Selection */}
          {priorityCategories.length > 0 && (
            <div>
              <label className="mb-2 block text-sm font-semibold text-foreground">
                Priority (for all group members)
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedPriority(null)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                    selectedPriority === null
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  Normal
                </button>
                {priorityCategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedPriority(cat)}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium border-2 transition-colors ${
                      selectedPriority?.id === cat.id
                        ? 'text-white'
                        : 'bg-transparent'
                    }`}
                    style={{
                      borderColor: cat.color ?? '#6b7280',
                      backgroundColor:
                        selectedPriority?.id === cat.id
                          ? cat.color ?? '#6b7280'
                          : 'transparent',
                      color:
                        selectedPriority?.id === cat.id
                          ? '#ffffff'
                          : cat.color ?? '#6b7280',
                    }}
                  >
                    {cat.icon && <span>{cat.icon}</span>}
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || members.length === 0}
            className="flex-1 rounded-lg bg-primary px-4 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading
              ? 'Creating...'
              : `Create ${members.length} Ticket${members.length > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
