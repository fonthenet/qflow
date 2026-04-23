/**
 * QR Codes Hub — central access point for every public-facing QR/deeplink the
 * business exposes. Uses the same routes & settings keys that the web app
 * already owns (no new endpoints):
 *   - WhatsApp:   wa.me/<num>?text=<command>
 *   - Messenger:  m.me/<page>?ref=<command>
 *   - Web scan:   qflo.net/scan/<waCode>
 *   - Web book:   qflo.net/book/<officeSlug>
 *   - Kiosk:      qflo.net/kiosk/<officeSlug>
 *
 * Settings keys consumed: whatsapp_code, arabic_code, messenger_page_id,
 * platform_office_slug. Office slug replicates apps/web/src/lib/office-links.ts.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { t as translate, type DesktopLocale } from '../lib/i18n';

const APP_BASE_URL = 'https://qflo.net';
const QR_API = 'https://api.qrserver.com/v1/create-qr-code/';

function slugifyOfficeName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function getOfficePublicSlug(officeId: string, officeName: string, settings: Record<string, any>) {
  const configuredSlug = typeof settings?.platform_office_slug === 'string' && settings.platform_office_slug.trim().length > 0
    ? settings.platform_office_slug.trim()
    : slugifyOfficeName(officeName || '');
  return officeId ? `${configuredSlug}--${officeId}` : configuredSlug;
}

function qrUrl(data: string, size = 180) {
  return `${QR_API}?size=${size}x${size}&data=${encodeURIComponent(data)}`;
}

type QRCard = {
  key: string;
  title: string;
  subtitle: string;
  deeplink: string;
  icon: string;
  accent: string;
  disabled?: boolean;
  disabledReason?: string;
};

interface QRHubModalProps {
  locale: DesktopLocale;
  officeId: string;
  officeName: string;
  orgSettings: Record<string, any>;
  whatsappPhone: string | null;
  messengerPageId: string | null;
  onClose: () => void;
}

export function QRHubModal({
  locale,
  officeId,
  officeName,
  orgSettings,
  whatsappPhone,
  messengerPageId,
  onClose,
}: QRHubModalProps) {
  const t = (key: string, values?: Record<string, string | number | null | undefined>) =>
    translate(locale, key, values);

  const [enlarged, setEnlarged] = useState<{ url: string; label: string; deeplink: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const cards = useMemo<QRCard[]>(() => {
    const waNum = (whatsappPhone || '').replace(/\D/g, '');
    const waCode = String(orgSettings?.whatsapp_code ?? '').toUpperCase().trim();
    const arCode = String(orgSettings?.arabic_code ?? '').trim();
    const slug = getOfficePublicSlug(officeId, officeName, orgSettings);

    const buildWa = (cmd: string) =>
      waNum ? `https://wa.me/${waNum}?text=${encodeURIComponent(cmd)}` : '';
    const buildMsg = (cmd: string) =>
      messengerPageId ? `https://m.me/${messengerPageId}?ref=${encodeURIComponent(cmd)}` : '';

    const list: QRCard[] = [];

    // ── WhatsApp channel ────────────────────────────────────────
    if (waNum) {
      const greet = waCode ? `Hi ${waCode}` : 'Hi';
      list.push({
        key: 'wa_activate',
        icon: '💬',
        accent: '#25d366',
        title: t('Activate WhatsApp (say hi)'),
        subtitle: t('Opens the 24h window. Shows the customer their bookings or a welcome.'),
        deeplink: buildWa(greet),
      });
      list.push({
        key: 'wa_book',
        icon: '📅',
        accent: '#25d366',
        title: t('Book via WhatsApp'),
        subtitle: t('Starts the guided booking chat.'),
        deeplink: buildWa(waCode ? `BOOK ${waCode}` : 'BOOK'),
      });
      list.push({
        key: 'wa_mybookings',
        icon: '🗓',
        accent: '#25d366',
        title: t('My Bookings (WhatsApp)'),
        subtitle: t('Customer sees their own upcoming reservations.'),
        deeplink: buildWa(waCode ? `MY BOOKINGS ${waCode}` : 'MY BOOKINGS'),
      });
      if (arCode) {
        list.push({
          key: 'wa_arabic',
          icon: '🇩🇿',
          accent: '#25d366',
          title: t('WhatsApp (Arabic code)'),
          subtitle: t('Uses your Arabic code — same chat flow.'),
          deeplink: buildWa(`مرحبا ${arCode}`),
        });
      }
    } else {
      list.push({
        key: 'wa_disabled',
        icon: '💬',
        accent: '#94a3b8',
        title: t('WhatsApp channel'),
        subtitle: t('No WhatsApp number configured for this business.'),
        deeplink: '',
        disabled: true,
        disabledReason: t('Configure WhatsApp in Settings.'),
      });
    }

    // ── Messenger channel ──────────────────────────────────────
    if (messengerPageId) {
      list.push({
        key: 'msg_activate',
        icon: '💬',
        accent: '#0084ff',
        title: t('Messenger (start chat)'),
        subtitle: t('Opens Messenger with a BOOK command pre-filled.'),
        deeplink: buildMsg(waCode ? `BOOK_${waCode}` : 'BOOK'),
      });
    } else {
      list.push({
        key: 'msg_disabled',
        icon: '💬',
        accent: '#94a3b8',
        title: t('Messenger channel'),
        subtitle: t('No Messenger page linked for this business.'),
        deeplink: '',
        disabled: true,
        disabledReason: t('Link a Messenger page in Settings.'),
      });
    }

    // ── Web routes (always available) ──────────────────────────
    if (waCode) {
      list.push({
        key: 'web_scan',
        icon: '🔗',
        accent: '#6366f1',
        title: t('Welcome page (/scan)'),
        subtitle: t('Branded landing with channel buttons for the customer.'),
        deeplink: `${APP_BASE_URL}/scan/${encodeURIComponent(waCode)}`,
      });
    }
    if (slug) {
      list.push({
        key: 'web_book',
        icon: '🌐',
        accent: '#6366f1',
        title: t('Online booking page'),
        subtitle: t('Public booking form for this office.'),
        deeplink: `${APP_BASE_URL}/book/${slug}`,
      });
      list.push({
        key: 'web_kiosk',
        icon: '🖥',
        accent: '#8b5cf6',
        title: t('Kiosk mode'),
        subtitle: t('Walk-in check-in screen for this office.'),
        deeplink: `${APP_BASE_URL}/kiosk/${slug}`,
      });
    }

    return list;
  }, [officeId, officeName, orgSettings, whatsappPhone, messengerPageId, locale]);

  const copy = async (card: QRCard) => {
    if (!card.deeplink) return;
    try {
      await navigator.clipboard.writeText(card.deeplink);
      setCopiedKey(card.key);
      setTimeout(() => setCopiedKey(k => (k === card.key ? null : k)), 1600);
    } catch {}
  };

  const print = (card: QRCard) => {
    if (!card.deeplink) return;
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return;
    const safeTitle = card.title.replace(/</g, '&lt;');
    const safeSub = card.subtitle.replace(/</g, '&lt;');
    const safeLink = card.deeplink.replace(/</g, '&lt;');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title>
      <style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
      h1{font-size:20px;margin:8px 0}p{color:#475569;margin:4px 0 16px;max-width:320px}
      img{width:320px;height:320px;background:#fff;padding:8px;border:1px solid #e2e8f0;border-radius:8px}
      code{display:block;margin-top:12px;font-size:10px;color:#64748b;word-break:break-all;max-width:340px}</style></head>
      <body><h1>${safeTitle}</h1><p>${safeSub}</p>
      <img src="${qrUrl(card.deeplink, 400)}" alt="QR" />
      <code>${safeLink}</code>
      <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300));</script>
      </body></html>`);
    w.document.close();
  };

  const overlayStyle: CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
  };
  const panelStyle: CSSProperties = {
    background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)',
    borderRadius: 12, width: '100%', maxWidth: 1080, maxHeight: '90vh',
    display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
  };
  const headerStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 18px', borderBottom: '1px solid var(--border)',
  };
  const gridStyle: CSSProperties = {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 12, padding: 16, overflowY: 'auto',
  };
  const cardStyle = (accent: string, disabled?: boolean): CSSProperties => ({
    border: `1px solid var(--border)`,
    borderLeft: `4px solid ${accent}`,
    background: 'var(--surface)',
    borderRadius: 10, padding: 12,
    display: 'flex', flexDirection: 'column', gap: 10,
    opacity: disabled ? 0.55 : 1,
  });
  const btnStyle: CSSProperties = {
    padding: '6px 10px', fontSize: 11, fontWeight: 600,
    border: '1px solid var(--border)', background: 'transparent',
    color: 'var(--text)', borderRadius: 6, cursor: 'pointer',
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={e => e.stopPropagation()}>
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>
              📱 {t('QR Codes Hub')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
              {officeName} — {t('Print, share or scan any entry point.')}
            </div>
          </div>
          <button onClick={onClose} style={{ ...btnStyle, padding: '6px 12px' }}>✕</button>
        </div>

        <div style={gridStyle}>
          {cards.map(card => (
            <div key={card.key} style={cardStyle(card.accent, card.disabled)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{card.icon}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{card.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{card.subtitle}</div>
                </div>
              </div>

              {card.disabled ? (
                <div style={{
                  fontSize: 11, color: 'var(--text2)', fontStyle: 'italic',
                  padding: '20px 8px', textAlign: 'center',
                }}>
                  {card.disabledReason}
                </div>
              ) : (
                <>
                  <div
                    onClick={() => setEnlarged({ url: qrUrl(card.deeplink, 400), label: card.title, deeplink: card.deeplink })}
                    style={{
                      alignSelf: 'center', cursor: 'zoom-in',
                      background: '#fff', padding: 6, borderRadius: 8,
                    }}
                    title={t('Click to enlarge')}
                  >
                    <img src={qrUrl(card.deeplink, 160)} alt={card.title}
                      style={{ display: 'block', width: 140, height: 140 }} />
                  </div>
                  <div style={{
                    fontSize: 10, color: 'var(--text2)', wordBreak: 'break-all',
                    background: 'var(--surface2)', padding: '6px 8px', borderRadius: 6,
                    maxHeight: 48, overflow: 'hidden',
                  }}>
                    {card.deeplink}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={btnStyle} onClick={() => copy(card)}>
                      {copiedKey === card.key ? `✓ ${t('Copied')}` : t('Copy link')}
                    </button>
                    <button style={btnStyle} onClick={() => print(card)}>
                      🖨 {t('Print')}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {enlarged && (
        <div
          style={{ ...overlayStyle, background: 'rgba(15,23,42,0.85)', zIndex: 1100 }}
          onClick={() => setEnlarged(null)}
        >
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', padding: 20, borderRadius: 12, display: 'flex',
            flexDirection: 'column', alignItems: 'center', gap: 12, maxWidth: 480,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{enlarged.label}</div>
            <img src={enlarged.url} alt={enlarged.label} style={{ width: 360, height: 360 }} />
            <div style={{ fontSize: 10, color: '#475569', wordBreak: 'break-all', maxWidth: 360, textAlign: 'center' }}>
              {enlarged.deeplink}
            </div>
            <button style={{ ...btnStyle, color: '#0f172a' }} onClick={() => setEnlarged(null)}>
              {t('Close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
