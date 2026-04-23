import { useEffect, useState } from 'react';
import type { DesktopLocale } from '../lib/i18n';
import type { CurrencyUnit } from '../lib/money';
import { formatMoney } from '../lib/money';

interface Props {
  t: (k: string, v?: Record<string, any>) => string;
  locale: DesktopLocale;
}

// Station-local POS prefs. Currency unit toggles how money is displayed
// and typed across the POS (DA with 2 decimals vs centimes ×100). Storage
// stays in DA — this only swaps the view/input format.
export function POSSection({ t }: Props) {
  const [unit, setUnit] = useState<CurrencyUnit>('da');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (window as any).qf?.settings?.getPosCurrencyUnit?.().then((u: string) => {
      setUnit(u === 'centimes' ? 'centimes' : 'da');
    });
  }, []);

  const pick = async (next: CurrencyUnit) => {
    if (next === unit) return;
    setSaving(true);
    try {
      await (window as any).qf.settings.setPosCurrencyUnit(next);
      setUnit(next);
    } finally {
      setSaving(false);
    }
  };

  const sample = 1234.56;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 620 }}>
      <div>
        <div style={sectionTitle}>{t('Currency display')}</div>
        <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>
          {t('How money is shown and entered across the POS. Prices are always stored in dinars.')}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Option
          active={unit === 'da'}
          disabled={saving}
          onClick={() => pick('da')}
          title={t('Dinars (DA)')}
          preview={formatMoney(sample, 'da')}
          hint={t('Bank-style, 2 decimals (e.g. 1 234,56 DA)')}
        />
        <Option
          active={unit === 'centimes'}
          disabled={saving}
          onClick={() => pick('centimes')}
          title={t('Centimes')}
          preview={formatMoney(sample, 'centimes')}
          hint={t('Everyday Algerian speech, integer ×100 (e.g. 123 456 centim)')}
        />
      </div>
    </div>
  );
}

function Option({
  active, disabled, onClick, title, preview, hint,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  title: string;
  preview: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: 'left',
        padding: 14,
        borderRadius: 12,
        border: `2px solid ${active ? '#22c55e' : 'var(--border)'}`,
        background: 'var(--surface)',
        color: 'var(--text)',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14 }}>{title}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{preview}</div>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>{hint}</div>
    </button>
  );
}

const sectionTitle: React.CSSProperties = {
  fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5,
  color: 'var(--text3)', fontWeight: 700,
};
