'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useI18n } from '@/components/providers/locale-provider';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { QrPoster } from '@/components/admin/qr-poster';
import {
  createVirtualCode,
  deleteVirtualCode,
  toggleVirtualCode,
} from '@/lib/actions/admin-actions';

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
  const { t } = useI18n();
  const router = useRouter();
  const { confirm: styledConfirm } = useConfirmDialog();
  const [codes, setCodes] = useState(initialCodes);
  const [showModal, setShowModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showPosterModal, setShowPosterModal] = useState(false);
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
    business: t('One public join link for the whole business. Customers choose the location, department, and service.'),
    office: t('One join link for a specific location. Customers choose the department and service.'),
    department: t('One join link for a specific department. Customers only choose the service.'),
    service: t('One direct join link for a single service.'),
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
    if (!officeId) return t('Entire business');
    return offices.find((office) => office.id === officeId)?.name ?? t('Unknown office');
  }

  function getDepartmentName(departmentId: string | null) {
    if (!departmentId) return t('All departments');
    return departments.find((department) => department.id === departmentId)?.name ?? t('Unknown department');
  }

  function getServiceName(serviceId: string | null) {
    if (!serviceId) return t('All services');
    return services.find((service) => service.id === serviceId)?.name ?? t('Unknown service');
  }

  function getScopeLabel(code: VirtualCode) {
    if (code.service_id) return t('Service');
    if (code.department_id) return t('Department');
    if (code.office_id) return t('Office');
    return t('Business');
  }

  function getScopeSummary(code: VirtualCode) {
    if (code.service_id) {
      return `${getOfficeName(code.office_id)} -> ${getDepartmentName(code.department_id)} -> ${getServiceName(code.service_id)}`;
    }
    if (code.department_id) {
      return `${getOfficeName(code.office_id)} -> ${getDepartmentName(code.department_id)}`;
    }
    if (code.office_id) {
      return `${getOfficeName(code.office_id)} -> ${t('All departments')}`;
    }
    return `${organization?.name ?? t('Business')} -> ${t('All locations')}`;
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
      setError(t('Failed to generate QR code'));
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
        setError(t('Unable to identify the business for this code'));
        return;
      }

      if ((scope === 'office' || scope === 'department' || scope === 'service') && !officeId) {
        setError(t('Office is required for this code scope'));
        return;
      }

      if ((scope === 'department' || scope === 'service') && !departmentId) {
        setError(t('Department is required for this code scope'));
        return;
      }

      if (scope === 'service' && !serviceId) {
        setError(t('Service is required for this code scope'));
        return;
      }

      const result = await createVirtualCode(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }

      setShowModal(false);
      setError(null);
      setCodes((prev) => {
        if (!result.code) return prev;
        return [result.code, ...prev];
      });
      router.refresh();
    });
  }

  function handleToggle(codeId: string, currentStatus: boolean) {
    startTransition(async () => {
      const result = await toggleVirtualCode(codeId, !currentStatus);
      if (result?.error) {
        setError(result.error);
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

  async function handleDelete(codeId: string) {
    if (!await styledConfirm(t('Are you sure you want to delete this virtual code?'), { variant: 'danger', confirmLabel: 'Delete' })) return;
    startTransition(async () => {
      const result = await deleteVirtualCode(codeId);
      if (result?.error) {
        setError(result.error);
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
            {t('Join Links & QR')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('Create simple public links and QR codes so customers can join from outside.')}
          </p>
          {organization && (
            <p className="mt-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {organization.name}
            </p>
          )}
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {t('New Link')}
        </button>
      </div>

      {error && !showModal && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mb-4 rounded-xl border border-border bg-muted/20 p-4">
        <p className="text-sm font-medium text-foreground">{t('How these links work')}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('Create one link for the whole business or a narrower link for one location, department, or service. Customers only see the choices they still need to make.')}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Office')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Department')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Service')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Scope')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Join Path')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Status')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Created')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {codes.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  {t('No virtual codes found. Create your first code to get started.')}
                </td>
              </tr>
            )}
            {codes.map((code) => (
              <tr
                key={code.id}
                className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
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
                <td className="px-4 py-3 text-muted-foreground">
                  <code className="rounded bg-muted px-2 py-1 text-xs">
                    /join/{code.qr_token}
                  </code>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      code.is_active
                        ? 'bg-success/10 text-success'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {code.is_active ? t('Active') : t('Inactive')}
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
                      onClick={() => handleOpenUrl(code.qr_token)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                      title={t('Open join page')}
                    >
                      {t('Open')}
                    </button>
                    <button
                      onClick={() => handleShowQr(code)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                      title={t('Show QR Code')}
                    >
                      {t('QR')}
                    </button>
                    <button
                      onClick={() => {
                        setQrPreviewCode(code);
                        setShowPosterModal(true);
                      }}
                      className="rounded-md px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
                      title={t('Print Poster')}
                    >
                      {t('Poster')}
                    </button>
                    <button
                      onClick={() => handleCopyUrl(code.qr_token, code.id)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      {copiedId === code.id ? t('Copied!') : t('Copy URL')}
                    </button>
                    <button
                      onClick={() => handleToggle(code.id, code.is_active)}
                      disabled={isPending}
                      className="rounded-md px-2 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      {code.is_active ? t('Deactivate') : t('Activate')}
                    </button>
                    <button
                      onClick={() => handleDelete(code.id)}
                      disabled={isPending}
                      className="rounded-md px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                    >
                      {t('Delete')}
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
              {t('Create Join Link')}
            </h2>

            {error && (
              <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <form action={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Scope')} <span className="text-destructive">*</span>
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
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="business">{t('Entire business')}</option>
                  <option value="office">{t('Specific office')}</option>
                  <option value="department">{t('Specific department')}</option>
                  <option value="service">{t('Specific service')}</option>
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {scopeDescriptions[scope]}
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Office')} {scope !== 'business' ? <span className="text-destructive">*</span> : null}
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
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">{scope === 'business' ? t('Entire business') : t('Select an office')}</option>
                  {offices.map((office) => (
                    <option key={office.id} value={office.id}>
                      {office.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Department')} {scope === 'department' || scope === 'service' ? <span className="text-destructive">*</span> : null}
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
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  <option value="">
                    {scope === 'business' || scope === 'office'
                      ? t('All departments')
                      : t('Select a department')}
                  </option>
                  {filteredDepartments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Service')}{' '}
                  {scope === 'service' ? (
                    <span className="text-destructive">*</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t('(optional - leave blank for all services)')}</span>
                  )}
                </label>
                <select
                  name="service_id"
                  value={selectedServiceId}
                  onChange={(e) => setSelectedServiceId(e.target.value)}
                  disabled={!selectedDepartmentId || scope !== 'service'}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  <option value="">{t('All services in department')}</option>
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
                  {t('Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isPending ? t('Creating...') : t('Create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QR Poster Modal */}
      {showPosterModal && qrPreviewCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowPosterModal(false)}
          />
          <div className="relative z-10 w-full max-w-2xl my-8 rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">
                {t('QR Poster Preview')}
              </h2>
              <button
                onClick={() => setShowPosterModal(false)}
                className="rounded-md px-3 py-1 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                {t('Close')}
              </button>
            </div>
            <QrPoster
              businessName={organization?.name ?? 'Business'}
              qrUrl={getJoinUrl(qrPreviewCode.qr_token)}
              departmentName={
                qrPreviewCode.department_id
                  ? getDepartmentName(qrPreviewCode.department_id)
                  : qrPreviewCode.office_id
                    ? getOfficeName(qrPreviewCode.office_id)
                    : undefined
              }
            />
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
              {t('Virtual Queue QR Code')}
            </h2>
            <p className="mb-4 text-xs text-muted-foreground text-center">
              {getOfficeName(qrPreviewCode.office_id)} - {getDepartmentName(qrPreviewCode.department_id)}
              {qrPreviewCode.service_id ? ` - ${getServiceName(qrPreviewCode.service_id)}` : ''}
            </p>

            <div className="flex justify-center rounded-lg bg-white p-4">
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt={t('Virtual Queue QR Code')}
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
                {copiedId === qrPreviewCode.id ? t('Copied!') : t('Copy URL')}
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
                {t('Download QR')}
              </button>
            </div>

            <button
              onClick={() => {
                setShowQrModal(false);
                setShowPosterModal(true);
              }}
              className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
            >
              {t('Print Poster')}
            </button>

            <button
              onClick={() => setShowQrModal(false)}
              className="mt-3 w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              {t('Close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
