import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase, ensureAuth } from '../lib/supabase';
import { t as translate, type DesktopLocale } from '../lib/i18n';

interface Props {
  organizationId: string;
  locale: DesktopLocale;
  storedAuth?: { access_token?: string; refresh_token?: string; email?: string; password?: string };
  officeName?: string;
  onClose: () => void;
  onSaved?: () => void;
}

type SettingsShape = {
  booking_mode?: 'simple' | 'disabled';
  slot_duration_minutes?: number;
  daily_ticket_limit?: number;
  booking_horizon_days?: number;
  min_booking_lead_hours?: number;
  allow_cancellation?: boolean;
  whatsapp_enabled?: boolean;
  messenger_enabled?: boolean;
  [k: string]: any;
};

function numOrUndef(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function SettingsModal({ organizationId, locale, storedAuth, officeName, onClose, onSaved }: Props) {
  const t = (k: string, v?: Record<string, any>) => translate(locale, k, v);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [orgName, setOrgName] = useState<string>('');
  const orgIdRef = useRef<string>('');
  const originalRef = useRef<SettingsShape>({});

  // Editable fields
  const [bookingEnabled, setBookingEnabled] = useState(false);
  const [slotDuration, setSlotDuration] = useState<string>('30');
  const [dailyLimit, setDailyLimit] = useState<string>('');
  const [horizonDays, setHorizonDays] = useState<string>('7');
  const [leadHours, setLeadHours] = useState<string>('1');
  const [allowCancellation, setAllowCancellation] = useState(true);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [messengerEnabled, setMessengerEnabled] = useState(false);

  const resolveOrgId = useCallback(async (): Promise<string> => {
    if (orgIdRef.current) return orgIdRef.current;
    await ensureAuth(storedAuth);
    const sb = await getSupabase();
    let orgId = organizationId;
    if (!orgId || orgId === 'undefined') {
      const { data: userData } = await sb.auth.getUser();
      const authUserId = userData?.user?.id;
      if (!authUserId) throw new Error('Not authenticated');
      const { data: staffRow, error: staffErr } = await sb
        .from('staff')
        .select('organization_id')
        .eq('auth_user_id', authUserId)
        .single();
      if (staffErr) throw staffErr;
      orgId = (staffRow as any)?.organization_id ?? '';
      if (!orgId) throw new Error('Could not resolve organization');
    }
    orgIdRef.current = orgId;
    return orgId;
  }, [organizationId, storedAuth]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const orgId = await resolveOrgId();
      const sb = await getSupabase();
      const { data, error: err } = await sb
        .from('organizations')
        .select('name, settings')
        .eq('id', orgId)
        .single();
      if (err) { setError(err.message); return; }
      const s: SettingsShape = ((data as any)?.settings ?? {}) as SettingsShape;
      originalRef.current = s;
      setOrgName(((data as any)?.name ?? '') as string);
      setBookingEnabled((s.booking_mode ?? 'disabled') !== 'disabled');
      setSlotDuration(String(s.slot_duration_minutes ?? 30));
      setDailyLimit(s.daily_ticket_limit ? String(s.daily_ticket_limit) : '');
      setHorizonDays(String(s.booking_horizon_days ?? 7));
      setLeadHours(String(s.min_booking_lead_hours ?? 1));
      setAllowCancellation(s.allow_cancellation ?? true);
      setWhatsappEnabled(s.whatsapp_enabled ?? false);
      setMessengerEnabled(s.messenger_enabled ?? false);
    } catch (e: any) {
      setError(e?.message ?? t('Failed to load settings'));
    } finally {
      setLoading(false);
    }
  }, [resolveOrgId]);

  useEffect(() => { load(); }, [load]);

  const dirty = (() => {
    const o = originalRef.current;
    if (((o.booking_mode ?? 'disabled') !== 'disabled') !== bookingEnabled) return true;
    if ((o.slot_duration_minutes ?? 30) !== (numOrUndef(slotDuration) ?? 30)) return true;
    if ((o.daily_ticket_limit ?? 0) !== (numOrUndef(dailyLimit) ?? 0)) return true;
    if ((o.booking_horizon_days ?? 7) !== (numOrUndef(horizonDays) ?? 7)) return true;
    if ((o.min_booking_lead_hours ?? 1) !== (numOrUndef(leadHours) ?? 1)) return true;
    if ((o.allow_cancellation ?? true) !== allowCancellation) return true;
    if ((o.whatsapp_enabled ?? false) !== whatsappEnabled) return true;
    if ((o.messenger_enabled ?? false) !== messengerEnabled) return true;
    return false;
  })();

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const orgId = await resolveOrgId();
      const sb = await getSupabase();
      // Re-read to get freshest settings and merge
      const { data: cur, error: readErr } = await sb
        .from('organizations')
        .select('settings')
        .eq('id', orgId)
        .single();
      if (readErr) throw readErr;
      const current: SettingsShape = (((cur as any)?.settings ?? {}) as SettingsShape);
      const merged: SettingsShape = {
        ...current,
        booking_mode: bookingEnabled ? 'simple' : 'disabled',
        slot_duration_minutes: numOrUndef(slotDuration) ?? 30,
        daily_ticket_limit: numOrUndef(dailyLimit) ?? 0,
        booking_horizon_days: numOrUndef(horizonDays) ?? 7,
        min_booking_lead_hours: numOrUndef(leadHours) ?? 1,
        allow_cancellation: allowCancellation,
        whatsapp_enabled: whatsappEnabled,
        messenger_enabled: messengerEnabled,
      };
      const { error: updErr } = await sb
        .from('organizations')
        .update({ settings: merged } as any)
        .eq('id', orgId);
      if (updErr) throw updErr;
      // Refetch to confirm
      await load();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2200);
      onSaved?.();
    } catch (e: any) {
      setSaveError(e?.message ?? t('Failed to save settings'));
    } finally {
      setSaving(false);
    }
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg, #0f172a)',
    border: '1px solid var(--border, #475569)',
    borderRadius: 10,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    color: 'var(--text2, #94a3b8)',
    fontWeight: 600,
  };

  const inputStyle: React.CSSProperties = {
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--border, #475569)',
    background: 'var(--surface, #1e293b)',
    color: 'var(--text, #f1f5f9)',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  };

  const Toggle = ({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) => (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}>
      <span style={{ fontSize: 13, color: 'var(--text, #f1f5f9)', fontWeight: 500 }}>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!on)}
        style={{
          width: 42, height: 24, borderRadius: 12, border: 'none',
          background: on ? '#22c55e' : '#475569',
          position: 'relative', cursor: 'pointer', transition: 'background 0.15s',
          padding: 0,
        }}
        aria-pressed={on}
      >
        <span style={{
          position: 'absolute', top: 2, left: on ? 20 : 2, width: 20, height: 20,
          borderRadius: 10, background: '#fff', transition: 'left 0.15s',
        }} />
      </button>
    </label>
  );

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface, #1e293b)', borderRadius: 'var(--radius, 12px)', width: '100%', maxWidth: 720,
          height: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid var(--border, #475569)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid var(--border, #475569)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(180deg, rgba(100,116,139,0.10), transparent)',
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text, #f1f5f9)', fontWeight: 700 }}>
              ⚙ {t('Business Settings')}
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text3, #64748b)' }}>
              {t('Most important settings from your portal')}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid var(--border, #475569)', color: 'var(--text2, #94a3b8)',
              width: 32, height: 32, borderRadius: 8, fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: 'var(--text2, #94a3b8)', padding: 40 }}>{t('Loading...')}</p>
          ) : error ? (
            <p style={{ textAlign: 'center', color: 'var(--danger, #ef4444)', padding: 40 }}>{error}</p>
          ) : (
            <>
              {/* Business info */}
              <div style={cardStyle}>
                <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
                  {t('Business info')}
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={labelStyle}>{t('Organization')}</div>
                    <div style={{ fontSize: 14, color: 'var(--text, #f1f5f9)', marginTop: 4 }}>{orgName || '—'}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={labelStyle}>{t('Office')}</div>
                    <div style={{ fontSize: 14, color: 'var(--text, #f1f5f9)', marginTop: 4 }}>{officeName || '—'}</div>
                  </div>
                </div>
              </div>

              {/* Online Booking */}
              <div style={cardStyle}>
                <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
                  {t('Online Booking')}
                </div>
                <Toggle on={bookingEnabled} onChange={setBookingEnabled} label={t('Enable online booking')} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={labelStyle}>{t('Slot duration (minutes)')}</div>
                    <input
                      type="number" min={5} step={5} value={slotDuration}
                      onChange={(e) => setSlotDuration(e.target.value)}
                      style={{ ...inputStyle, marginTop: 4 }}
                    />
                  </div>
                  <div>
                    <div style={labelStyle}>{t('Daily booking limit')}</div>
                    <input
                      type="number" min={0} value={dailyLimit}
                      onChange={(e) => setDailyLimit(e.target.value)}
                      placeholder={t('Unlimited')}
                      style={{ ...inputStyle, marginTop: 4 }}
                    />
                  </div>
                  <div>
                    <div style={labelStyle}>{t('Booking advance (days)')}</div>
                    <input
                      type="number" min={1} value={horizonDays}
                      onChange={(e) => setHorizonDays(e.target.value)}
                      style={{ ...inputStyle, marginTop: 4 }}
                    />
                  </div>
                  <div>
                    <div style={labelStyle}>{t('Minimum lead time (hours)')}</div>
                    <input
                      type="number" min={0} value={leadHours}
                      onChange={(e) => setLeadHours(e.target.value)}
                      style={{ ...inputStyle, marginTop: 4 }}
                    />
                  </div>
                </div>
                <Toggle on={allowCancellation} onChange={setAllowCancellation} label={t('Allow customer cancellation')} />
              </div>

              {/* Channels */}
              <div style={cardStyle}>
                <div style={{ fontSize: 11, color: 'var(--text3, #64748b)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
                  {t('Channels')}
                </div>
                <Toggle on={whatsappEnabled} onChange={setWhatsappEnabled} label={t('WhatsApp')} />
                <Toggle on={messengerEnabled} onChange={setMessengerEnabled} label={t('Messenger')} />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 22px', borderTop: '1px solid var(--border, #475569)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          {saveError && (
            <span style={{ color: 'var(--danger, #ef4444)', fontSize: 12, flex: 1 }}>{saveError}</span>
          )}
          {savedFlash && !saveError && (
            <span style={{ color: '#22c55e', fontSize: 12, fontWeight: 600, flex: 1 }}>✓ {t('Saved')}</span>
          )}
          {!saveError && !savedFlash && <div style={{ flex: 1 }} />}
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid var(--border, #475569)', color: 'var(--text2, #94a3b8)',
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >{t('Cancel')}</button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving || loading}
            style={{
              background: !dirty || saving || loading ? 'var(--border, #475569)' : 'var(--primary, #3b82f6)',
              color: '#fff', border: 'none',
              padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: !dirty || saving || loading ? 'not-allowed' : 'pointer',
              opacity: !dirty || saving || loading ? 0.6 : 1,
            }}
          >{saving ? t('Loading...') : t('Save changes')}</button>
        </div>
      </div>
    </div>
  );
}
