import { useEffect, useState } from 'react';
import type { CurrencyUnit } from './money';

// Station-local pref: should POS surfaces display/input money as dinars
// (2-decimal) or centimes (×100 integer). Storage is always DA — this
// only swaps the view. Hooked into IPC so a change in Settings flips
// every open POS component immediately.
export function usePosCurrencyUnit(): CurrencyUnit {
  const [unit, setUnit] = useState<CurrencyUnit>('da');
  useEffect(() => {
    let mounted = true;
    (window as any).qf?.settings?.getPosCurrencyUnit?.().then((u: string) => {
      if (mounted) setUnit(u === 'centimes' ? 'centimes' : 'da');
    });
    const off = (window as any).qf?.settings?.onPosCurrencyUnitChange?.((u: string) => {
      setUnit(u === 'centimes' ? 'centimes' : 'da');
    });
    return () => { mounted = false; off?.(); };
  }, []);
  return unit;
}
