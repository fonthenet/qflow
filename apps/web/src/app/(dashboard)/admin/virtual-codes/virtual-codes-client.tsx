'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { nanoid } from 'nanoid';
import QRCode from 'qrcode';

interface VirtualCode {
  id: string;
  organization_id: string;
  qr_token: string;
  office_id: string | null;
  department_id: string | null;
  service_id: string | null;
  is_active: boolean;
  created_at: string;
}

interface Office {
  id: string;
  name: string;
  organization_id: string;
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
  organization: { id: string; name: string } | null;
}

export function VirtualCodesClient({
  codes: initialCodes,
  offices,
  departments,
  services,
  organization,
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
  const [scope, setScope] = useState<'business' | 'office' | 'department' | 'service'>('department');
  const [selectedOfficeId, setSelectedOfficeId] = useState('');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');

  const filteredDepartments = departments.filter(
    (d) => d.office_id === selectedOfficeId
  );
  const filteredServices = services.filter(
    (s) => s.department_id === selectedDepartmentId
  );

  const scopeDescriptions: Record<typeof scope, string> = {
    business: 'One public join link for the whole business. Customers choose the location, department, and service.',
    office: 'One join link for a specific location. Customers choose the department and service.',
    department: 'One join link for a specific department. Customers only choose the service.',
    service: 'One direct join link for a single service.',
  };

  function openCreate() {
    setError(null);
    setScope('department');
    setSelectedOfficeId('');
    setSelectedDepartmentId('');
    setSelectedServiceId('');
    setShowModal(true);
  }

  function getOfficeName(officeId: string | null) {
    if (!officeId) return 'Entire business';
    return offices.find((office) => office.id === officeId)?.name ?? 'Unknown office';
  }

  function getDepartmentName(departmentId: string | null) {
    if (!departmentId) return 'All departments';
    return departments.find((department) => department.id === departmentId)?.name ?? 'Unknown department';
  }

  function getServiceName(serviceId: string | null) {
    if (!serviceId) return 'All services';
    return services.find((service) => service.id === serviceId)?.name ?? 'Unknown service';
  }

  function getScopeLabel(code: VirtualCode) {
    if (code.service_id) return 'Service';
    if (code.department_id) return 'Department';
    if (code.office_id) return 'Office';
    return 'Business';
  }

  function getScopeSummary(code: VirtualCode) {
    if (code.service_id) {
      return `${getOfficeName(code.office_id)} -> ${getDepartmentName(code.department_id)} -> ${getServiceName(code.service_id)}`;
    }
    if (code.department_id) {
      return `${getOfficeName(code.office_id)} -> ${getDepartmentName(code.department_id)}`;
    }
    if (code.office_id) {
      return `${getOfficeName(code.office_id)} -> All departments`;
    }
    return `${organization?.name ?? 'Business'} -> All locations`;
  }

  function handleOpenUrl(token: string) {
    window.open(getJoinUrl(token), '_blank', 'noopener,noreferrer');
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

      if (!organization?.id) {
        setError('Unable to identify the business for this code');
        return;
      }

      if ((scope === 'office' || scope === 'department' || scope === 'service') && !officeId) {
        setError('Office is required for this code scope');
        return;
      }

      if ((scope === 'department' || scope === 'service') && !departmentId) {
        setError('Department is required for this code scope');
        return;
      }

      if (scope === 'service' && !serviceId) {
        setError('Service is required for this code scope');
        return;
      }

      const supabase = createClient();
      const qrToken = nanoid(16);

      const insertData: any = {
        organization_id: organization.id,
        office_id: scope === 'business' ? null : officeId,
        department_id:
          scope === 'department' || scope === 'service' ? departmentId : null,
        qr_token: qrToken,
        is_active: true,
      };

      if (scope === 'service' && serviceId) {
        insertData.service_id = serviceId;
      }

      const { data: newCode, error: insertError } = await supabase
        .from('virtual_queue_codes')
        .insert(insertData)
        .select('*')
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
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Join Links & QR
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
            Create simple public links and QR codes so customers can join from outside.
          </p>
          {organization && (
            <p className="mt-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {organization.name}
            </p>
          )}
        </div>
        <button
          onClick={openCreate}
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors"
        >
          New Link
        </button>
      </div>

      {error && !showModal && (
        <div className="mb-4 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mb-4 rounded-2xl border border-border/60 bg-muted/20 p-4">
        <p className="text-sm font-medium text-foreground">How these links work</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Create one link for the whole business or a narrower link for one location, department, or service. Customers only see the choices they still need to make.
        </p>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-x-auto">
        <table className="w-full min-w-[580px] text-left text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/50">
              <th className="px-4 py-3 font-medium text-muted-foreground">Office</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Department</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Service</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Scope</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Created</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {codes.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No virtual codes found. Create your first code to get started.
                </td>
              </tr>
            )}
            {codes.map((code) => (
              <tr
                key={code.id}
                className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors"
              >
                <td className="px-4 py-3 font-medium text-foreground">
                  {getOfficeName(code.office_id)}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {getDepartmentName(code.department_id)}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {getServiceName(code.service_id)}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  <div>
                    <p className="font-medium text-foreground">{getScopeLabel(code)}</p>
                    <p className="text-xs text-muted-foreground">{getScopeSummary(code)}</p>
                  </div>
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
                  <div className="inline-flex items-center rounded-xl border border-border/60 overflow-hidden divide-x divide-border/60 bg-background shadow-sm">
                    {/* Open */}
                    <button
                      onClick={() => handleOpenUrl(code.qr_token)}
                      title="Open join page"
                      className="px-2.5 py-1.5 hover:bg-muted transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                    </button>
                    {/* QR */}
                    <button
                      onClick={() => handleShowQr(code)}
                      title="Show QR Code"
                      className="px-2.5 py-1.5 hover:bg-primary/10 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/><rect x="18" y="14" width="3" height="3"/><rect x="14" y="18" width="3" height="3"/><rect x="18" y="18" width="3" height="3"/>
                      </svg>
                    </button>
                    {/* Copy URL */}
                    <button
                      onClick={() => handleCopyUrl(code.qr_token, code.id)}
                      title="Copy join URL"
                      className="px-2.5 py-1.5 hover:bg-muted transition-colors"
                    >
                      {copiedId === code.id ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                      )}
                    </button>
                    {/* Toggle active */}
                    <button
                      onClick={() => handleToggle(code.id, code.is_active)}
                      disabled={isPending}
                      title={code.is_active ? 'Deactivate' : 'Activate'}
                      className="px-2.5 py-1.5 hover:bg-muted transition-colors disabled:opacity-40"
                    >
                      {code.is_active ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                        </svg>
                      )}
                    </button>
                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(code.id)}
                      disabled={isPending}
                      title="Delete"
                      className="px-2.5 py-1.5 hover:bg-destructive/10 transition-colors disabled:opacity-40"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-destructive" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                      </svg>
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
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              Create Join Link
            </h2>

            {error && (
              <div className="mb-4 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <form action={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Scope <span className="text-destructive">*</span>
                </label>
                <select
                  name="scope"
                  value={scope}
                  onChange={(e) => {
                    const nextScope = e.target.value as typeof scope;
                    setScope(nextScope);
                    setSelectedOfficeId('');
                    setSelectedDepartmentId('');
                    setSelectedServiceId('');
                  }}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                >
                  <option value="business">Entire business</option>
                  <option value="office">Specific office</option>
                  <option value="department">Specific department</option>
                  <option value="service">Specific service</option>
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {scopeDescriptions[scope]}
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Office {scope !== 'business' ? <span className="text-destructive">*</span> : null}
                </label>
                <select
                  name="office_id"
                  required={scope !== 'business'}
                  value={selectedOfficeId}
                  onChange={(e) => {
                    setSelectedOfficeId(e.target.value);
                    setSelectedDepartmentId('');
                    setSelectedServiceId('');
                  }}
                  disabled={scope === 'business'}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                >
                  <option value="">{scope === 'business' ? 'Entire business' : 'Select an office'}</option>
                  {offices.map((office) => (
                    <option key={office.id} value={office.id}>
                      {office.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Department {scope === 'department' || scope === 'service' ? <span className="text-destructive">*</span> : null}
                </label>
                <select
                  name="department_id"
                  required={scope === 'department' || scope === 'service'}
                  value={selectedDepartmentId}
                  onChange={(e) => {
                    setSelectedDepartmentId(e.target.value);
                    setSelectedServiceId('');
                  }}
                  disabled={!selectedOfficeId || scope === 'business' || scope === 'office'}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all disabled:opacity-50"
                >
                  <option value="">
                    {scope === 'business' || scope === 'office'
                      ? 'All departments'
                      : 'Select a department'}
                  </option>
                  {filteredDepartments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Service{' '}
                  {scope === 'service' ? (
                    <span className="text-destructive">*</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">(optional - leave blank for all services)</span>
                  )}
                </label>
                <select
                  name="service_id"
                  value={selectedServiceId}
                  onChange={(e) => setSelectedServiceId(e.target.value)}
                  disabled={!selectedDepartmentId || scope !== 'service'}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all disabled:opacity-50"
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
                  className="rounded-xl border border-border/60 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors disabled:opacity-50"
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
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowQrModal(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-border/60 bg-card p-6 shadow-xl">
            <h2 className="mb-2 text-lg font-semibold text-foreground text-center">
              Virtual Queue QR Code
            </h2>
            <p className="mb-4 text-xs text-muted-foreground text-center">
              {getOfficeName(qrPreviewCode.office_id)} - {getDepartmentName(qrPreviewCode.department_id)}
              {qrPreviewCode.service_id ? ` - ${getServiceName(qrPreviewCode.service_id)}` : ''}
            </p>

            <div className="flex justify-center rounded-2xl bg-white p-4 shadow-sm">
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
                className="flex-1 rounded-xl border border-border/60 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
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
                className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors"
              >
                Download QR
              </button>
            </div>

            <button
              onClick={() => setShowQrModal(false)}
              className="mt-3 w-full rounded-xl border border-border/60 px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
