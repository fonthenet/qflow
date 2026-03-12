'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { nanoid } from 'nanoid';
import QRCode from 'qrcode';

interface VirtualCode {
  id: string;
  qr_token: string;
  office_id: string;
  department_id: string;
  service_id: string | null;
  is_active: boolean;
  created_at: string;
  office: { name: string } | null;
  department: { name: string } | null;
  service: { name: string } | null;
}

interface Office {
  id: string;
  name: string;
}

interface Department {
  id: string;
  name: string;
  office_id: string;
}

interface Service {
  id: string;
  name: string;
  department_id: string;
}

interface VirtualCodesClientProps {
  codes: VirtualCode[];
  offices: Office[];
  departments: Department[];
  services: Service[];
}

export function VirtualCodesClient({
  codes: initialCodes,
  offices,
  departments,
  services,
}: VirtualCodesClientProps) {
  const router = useRouter();
  const [codes, setCodes] = useState(initialCodes);
  const [showModal, setShowModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrPreviewCode, setQrPreviewCode] = useState<VirtualCode | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedOfficeId, setSelectedOfficeId] = useState('');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');

  const filteredDepartments = departments.filter(
    (d) => d.office_id === selectedOfficeId
  );
  const filteredServices = services.filter(
    (s) => s.department_id === selectedDepartmentId
  );

  function openCreate() {
    setError(null);
    setSelectedOfficeId('');
    setSelectedDepartmentId('');
    setSelectedServiceId('');
    setShowModal(true);
  }

  async function handleShowQr(code: VirtualCode) {
    setQrPreviewCode(code);
    const joinUrl = `${window.location.origin}/join/${code.qr_token}`;
    try {
      const dataUrl = await QRCode.toDataURL(joinUrl, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
      setQrDataUrl(dataUrl);
      setShowQrModal(true);
    } catch {
      setError('Failed to generate QR code');
    }
  }

  function getJoinUrl(token: string) {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/join/${token}`;
    }
    return `/join/${token}`;
  }

  async function handleCopyUrl(token: string, codeId: string) {
    const url = getJoinUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(codeId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedId(codeId);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const officeId = formData.get('office_id') as string;
      const departmentId = formData.get('department_id') as string;
      const serviceId = (formData.get('service_id') as string) || null;

      if (!officeId || !departmentId) {
        setError('Office and department are required');
        return;
      }

      const supabase = createClient();
      const qrToken = nanoid(16);

      const insertData: any = {
        office_id: officeId,
        department_id: departmentId,
        qr_token: qrToken,
        is_active: true,
      };

      if (serviceId) {
        insertData.service_id = serviceId;
      }

      const { data: newCode, error: insertError } = await supabase
        .from('virtual_queue_codes')
        .insert(insertData)
        .select('*, office:offices(name), department:departments(name), service:services(name)')
        .single();

      if (insertError) {
        setError(insertError.message);
        return;
      }

      setCodes((prev) => [newCode, ...prev]);
      setShowModal(false);
      setError(null);
      router.refresh();
    });
  }

  function handleToggle(codeId: string, currentStatus: boolean) {
    startTransition(async () => {
      const supabase = createClient();

      const { error: updateError } = await supabase
        .from('virtual_queue_codes')
        .update({ is_active: !currentStatus })
        .eq('id', codeId);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setCodes((prev) =>
        prev.map((c) =>
          c.id === codeId ? { ...c, is_active: !currentStatus } : c
        )
      );
      router.refresh();
    });
  }

  function handleDelete(codeId: string) {
    if (!confirm('Are you sure you want to delete this virtual code?')) return;
    startTransition(async () => {
      const supabase = createClient();

      const { error: deleteError } = await supabase
        .from('virtual_queue_codes')
        .delete()
        .eq('id', codeId);

      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      setCodes((prev) => prev.filter((c) => c.id !== codeId));
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Virtual Queue Codes
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage QR codes for remote queue joining. Customers scan these to join the queue from outside.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Create Code
        </button>
      </div>

      {error && !showModal && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 font-medium text-muted-foreground">Office</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Department</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Service</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Created</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {codes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No virtual codes found. Create your first code to get started.
                </td>
              </tr>
            )}
            {codes.map((code) => (
              <tr
                key={code.id}
                className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
              >
                <td className="px-4 py-3 font-medium text-foreground">
                  {code.office?.name ?? '---'}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {code.department?.name ?? '---'}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {code.service?.name ?? 'All services'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      code.is_active
                        ? 'bg-success/10 text-success'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {code.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {code.created_at
                    ? new Date(code.created_at).toLocaleDateString()
                    : '---'}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => handleShowQr(code)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                      title="Show QR Code"
                    >
                      QR
                    </button>
                    <button
                      onClick={() => handleCopyUrl(code.qr_token, code.id)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      {copiedId === code.id ? 'Copied!' : 'Copy URL'}
                    </button>
                    <button
                      onClick={() => handleToggle(code.id, code.is_active)}
                      disabled={isPending}
                      className="rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      {code.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => handleDelete(code.id)}
                      disabled={isPending}
                      className="rounded-md px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowModal(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              Create Virtual Queue Code
            </h2>

            {error && (
              <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <form action={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Office <span className="text-destructive">*</span>
                </label>
                <select
                  name="office_id"
                  required
                  value={selectedOfficeId}
                  onChange={(e) => {
                    setSelectedOfficeId(e.target.value);
                    setSelectedDepartmentId('');
                    setSelectedServiceId('');
                  }}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select an office</option>
                  {offices.map((office) => (
                    <option key={office.id} value={office.id}>
                      {office.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Department <span className="text-destructive">*</span>
                </label>
                <select
                  name="department_id"
                  required
                  value={selectedDepartmentId}
                  onChange={(e) => {
                    setSelectedDepartmentId(e.target.value);
                    setSelectedServiceId('');
                  }}
                  disabled={!selectedOfficeId}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  <option value="">Select a department</option>
                  {filteredDepartments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Service <span className="text-xs text-muted-foreground">(optional - leave blank for all services)</span>
                </label>
                <select
                  name="service_id"
                  value={selectedServiceId}
                  onChange={(e) => setSelectedServiceId(e.target.value)}
                  disabled={!selectedDepartmentId}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  <option value="">All services in department</option>
                  {filteredServices.map((svc) => (
                    <option key={svc.id} value={svc.id}>
                      {svc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isPending ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QR Code Preview Modal */}
      {showQrModal && qrPreviewCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowQrModal(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
            <h2 className="mb-2 text-lg font-semibold text-foreground text-center">
              Virtual Queue QR Code
            </h2>
            <p className="mb-4 text-xs text-muted-foreground text-center">
              {qrPreviewCode.office?.name} - {qrPreviewCode.department?.name}
              {qrPreviewCode.service?.name ? ` - ${qrPreviewCode.service.name}` : ''}
            </p>

            <div className="flex justify-center rounded-lg bg-white p-4">
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt="Virtual Queue QR Code"
                  className="h-64 w-64"
                />
              )}
            </div>

            <p className="mt-3 text-center text-xs text-muted-foreground break-all">
              {getJoinUrl(qrPreviewCode.qr_token)}
            </p>

            <div className="mt-4 flex gap-3">
              <button
                onClick={() => handleCopyUrl(qrPreviewCode.qr_token, qrPreviewCode.id)}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                {copiedId === qrPreviewCode.id ? 'Copied!' : 'Copy URL'}
              </button>
              <button
                onClick={() => {
                  // Download QR image
                  const link = document.createElement('a');
                  link.download = `qr-${qrPreviewCode.qr_token}.png`;
                  link.href = qrDataUrl;
                  link.click();
                }}
                className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Download QR
              </button>
            </div>

            <button
              onClick={() => setShowQrModal(false)}
              className="mt-3 w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
