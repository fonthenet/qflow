import { useCallback, useEffect, useState } from 'react';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import { buildReceiptHtml } from '../lib/receipt';

interface Printer {
  id: string;
  name: string;
  driver_name: string;
  width_mm: number;
  kind: string;
  is_default: 0 | 1;
  enabled: 0 | 1;
}

interface SystemPrinter {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  status: number;
}

interface Props {
  t: (k: string, v?: Record<string, any>) => string;
  locale: DesktopLocale;
}

// Printers settings panel — station-local list (not synced). User picks a
// Windows-installed driver and maps it to a logical role ("receipt"). The
// receipt flow (PaymentModal) reads the default receipt printer from this
// list. Test Print prints a short sample so the operator can confirm
// paper width / driver selection before the first real receipt.
export function PrintersSection({ t, locale }: Props) {
  const [systemPrinters, setSystemPrinters] = useState<SystemPrinter[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [sys, mine] = await Promise.all([
      (window as any).qf?.printers?.listSystem?.().catch(() => []),
      (window as any).qf?.printers?.list?.().catch(() => []),
    ]);
    setSystemPrinters(Array.isArray(sys) ? sys : []);
    setPrinters(Array.isArray(mine) ? mine : []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const addFromSystem = async (sp: SystemPrinter) => {
    setBusy(true);
    setMsg(null);
    try {
      await (window as any).qf.printers.upsert({
        name: sp.displayName || sp.name,
        driver_name: sp.name,
        width_mm: 80,
        kind: 'receipt',
        is_default: printers.length === 0 ? 1 : 0,
        enabled: 1,
      });
      await load();
    } catch (e: any) {
      setMsg(e?.message ?? 'Failed');
    } finally { setBusy(false); }
  };

  const updatePrinter = async (p: Printer, patch: Partial<Printer>) => {
    setBusy(true);
    try {
      await (window as any).qf.printers.upsert({ ...p, ...patch });
      await load();
    } finally { setBusy(false); }
  };

  const removePrinter = async (p: Printer) => {
    if (!confirm(t('Remove printer "{name}"?', { name: p.name }))) return;
    setBusy(true);
    try {
      await (window as any).qf.printers.delete(p.id);
      await load();
    } finally { setBusy(false); }
  };

  const testPrint = async (p: Printer) => {
    setBusy(true);
    setMsg(null);
    try {
      const html = buildReceiptHtml({
        orgName: 'Qflo',
        ticketNumber: 'TEST-001',
        tableCode: 'T1',
        staffName: null,
        items: [
          { name: t('Test item 1'), qty: 1, price: 500 },
          { name: t('Test item 2'), qty: 2, price: 250 },
        ],
        total: 1000,
        tendered: 1000,
        change: 0,
        currency: 'DA',
        paidAt: new Date(),
        widthMm: p.width_mm || 80,
        locale,
      });
      await (window as any).qf.receipts.print({
        driverName: p.driver_name,
        html,
        widthMm: p.width_mm || 80,
        silent: true,
      });
      setMsg(t('Test receipt sent to {name}.', { name: p.name }));
    } catch (e: any) {
      setMsg(e?.message ?? 'Print failed');
    } finally { setBusy(false); }
  };

  const configuredDrivers = new Set(printers.map((p) => p.driver_name));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>🖨️ {t('Printers')}</h3>
        <div style={{ fontSize: 12, color: 'var(--text3, #64748b)', lineHeight: 1.4 }}>
          {t('Receipts are printed through your Windows-installed driver. Install the thermal printer in Windows first, then pick it here.')}
        </div>
      </div>

      {msg && (
        <div style={{ padding: 10, borderRadius: 8, background: 'var(--surface2, #334155)', fontSize: 13 }}>
          {msg}
        </div>
      )}

      {/* Configured printers */}
      <div>
        <div style={sectionTitle}>{t('Configured')}</div>
        {printers.length === 0 ? (
          <div style={{ padding: 14, color: 'var(--text3, #64748b)', fontSize: 13 }}>
            {t('No printers configured yet.')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {printers.map((p) => (
              <div key={p.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.driver_name}
                    </div>
                  </div>
                  <span style={{ ...pill, background: p.is_default ? '#22c55e' : 'var(--surface2)', color: p.is_default ? '#fff' : 'var(--text)' }}>
                    {p.is_default ? t('Default') : t('Secondary')}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
                  <label style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {t('Width')}
                    <select
                      value={p.width_mm}
                      onChange={(e) => updatePrinter(p, { width_mm: Number(e.target.value) })}
                      style={selectStyle}
                      disabled={busy}
                    >
                      <option value={58}>58 mm</option>
                      <option value={80}>80 mm</option>
                    </select>
                  </label>
                  <label style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={!!p.enabled}
                      onChange={(e) => updatePrinter(p, { enabled: e.target.checked ? 1 : 0 })}
                      disabled={busy}
                    />
                    {t('Enabled')}
                  </label>
                  {!p.is_default && p.enabled ? (
                    <button onClick={() => updatePrinter(p, { is_default: 1 })} style={ghostBtn} disabled={busy}>
                      {t('Set default')}
                    </button>
                  ) : null}
                  <button onClick={() => testPrint(p)} style={ghostBtn} disabled={busy || !p.enabled}>
                    {t('Test print')}
                  </button>
                  <button onClick={() => removePrinter(p)} style={{ ...ghostBtn, color: '#ef4444', marginLeft: 'auto' }} disabled={busy}>
                    {t('Remove')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* System printers */}
      <div>
        <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{t('Installed on this PC')}</span>
          <button onClick={load} style={ghostBtn} disabled={busy}>{t('Refresh')}</button>
        </div>
        {systemPrinters.length === 0 ? (
          <div style={{ padding: 14, color: 'var(--text3, #64748b)', fontSize: 13 }}>
            {t('No printers detected on this PC.')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {systemPrinters.map((sp) => {
              const already = configuredDrivers.has(sp.name);
              return (
                <div key={sp.name} style={{ ...card, padding: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {sp.displayName || sp.name}
                      {sp.isDefault && <span style={{ ...pill, marginLeft: 8 }}>{t('System default')}</span>}
                    </div>
                    {sp.description && (
                      <div style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sp.description}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => addFromSystem(sp)}
                    disabled={busy || already}
                    style={already ? { ...ghostBtn, opacity: 0.5, cursor: 'default' } : primaryBtn}
                  >
                    {already ? t('Added') : t('Add')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const sectionTitle: React.CSSProperties = {
  fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5,
  color: 'var(--text3, #64748b)', fontWeight: 700, marginBottom: 8,
};
const card: React.CSSProperties = {
  padding: 12, borderRadius: 10, border: '1px solid var(--border)',
  background: 'var(--surface, #1e293b)',
};
const pill: React.CSSProperties = {
  padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
  background: 'var(--surface2, #334155)', color: 'var(--text)',
};
const ghostBtn: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer',
  fontSize: 12, fontWeight: 600,
};
const primaryBtn: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 8, border: 'none',
  background: '#3b82f6', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700,
};
const selectStyle: React.CSSProperties = {
  padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 12,
  colorScheme: 'light dark',
};
