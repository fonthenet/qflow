import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Custom DatePicker — replaces native <input type="date"> with a compact themed
 * calendar dropdown. Supports month/year quick-select for date-of-birth use cases.
 *
 * Props mirror a standard date input: value, onChange, min, max, disabled, style.
 */

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (e: { target: { value: string } }) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  placeholder?: string;
}

const DAYS_SHORT = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function firstDayOfWeek(year: number, month: number): number {
  const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const d = new Date(dateKey + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun
  return dow === 0 ? 6 : dow - 1; // Monday = 0
}

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

function toKey(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

type ViewMode = 'days' | 'months' | 'years';

export default function DatePicker({ value, onChange, min, max, disabled, style, placeholder }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('days');
  const ref = useRef<HTMLDivElement>(null);
  const yearGridRef = useRef<HTMLDivElement>(null);

  const parsed = value ? new Date(value + 'T00:00:00') : null;
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? new Date().getMonth());
  // Year range page (shows 12 years at a time)
  const [yearPage, setYearPage] = useState(Math.floor((parsed?.getFullYear() ?? new Date().getFullYear()) / 12) * 12);

  // Sync view when value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value + 'T00:00:00');
      if (!isNaN(d.getTime())) {
        setViewYear(d.getFullYear());
        setViewMonth(d.getMonth());
        setYearPage(Math.floor(d.getFullYear() / 12) * 12);
      }
    }
  }, [value]);

  // Reset to day view when opening
  useEffect(() => {
    if (open) setViewMode('days');
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); e.stopPropagation(); } };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const prevMonth = useCallback(() => {
    setViewMonth(m => { if (m === 0) { setViewYear(y => y - 1); return 11; } return m - 1; });
  }, []);
  const nextMonth = useCallback(() => {
    setViewMonth(m => { if (m === 11) { setViewYear(y => y + 1); return 0; } return m + 1; });
  }, []);

  const selectDay = useCallback((day: number) => {
    const key = toKey(viewYear, viewMonth, day);
    onChange({ target: { value: key } });
    setOpen(false);
  }, [viewYear, viewMonth, onChange]);

  const isDisabledDate = useCallback((key: string): boolean => {
    if (min && key < min) return true;
    if (max && key > max) return true;
    return false;
  }, [min, max]);

  const today = new Date();
  const todayKey = toKey(today.getFullYear(), today.getMonth(), today.getDate());
  const selectedKey = value || '';

  const dim = daysInMonth(viewYear, viewMonth);
  const startDay = firstDayOfWeek(viewYear, viewMonth);

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const displayValue = value
    ? new Date(value + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
    : '';

  const base: React.CSSProperties = {
    width: '100%', padding: '7px 10px', border: '1px solid var(--border, #475569)',
    borderRadius: 6, background: 'var(--bg, #0f172a)', color: 'var(--text, #f1f5f9)',
    fontSize: 13, outline: 'none', boxSizing: 'border-box', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1, position: 'relative' as const, fontFamily: 'inherit',
    ...style,
  };

  // Year grid for year picker
  const yearStart = yearPage;
  const yearEnd = yearPage + 11;
  const currentYear = today.getFullYear();

  return (
    <div ref={ref} style={{ position: 'relative', width: style?.width ?? '100%' }}>
      {/* Trigger */}
      <div
        onClick={() => { if (!disabled) setOpen(o => !o); }}
        style={base}
        tabIndex={0}
        role="combobox"
        aria-expanded={open}
      >
        <span style={{ color: displayValue ? 'var(--text, #f1f5f9)' : 'var(--text3, #64748b)' }}>
          {displayValue || placeholder || 'Select date'}
        </span>
        <span style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          fontSize: 12, color: 'var(--text3, #64748b)', pointerEvents: 'none',
        }}>📅</span>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 9999,
          width: 220, padding: 8,
          background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #475569)',
          borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          {/* ── Header: nav arrows + clickable month/year ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <button
              onClick={() => {
                if (viewMode === 'days') prevMonth();
                else if (viewMode === 'years') setYearPage(p => p - 12);
                else { setViewYear(y => y - 1); }
              }}
              type="button" style={navBtn}
            >‹</button>

            {viewMode === 'days' && (
              <button
                type="button"
                onClick={() => { setViewMode('months'); }}
                style={{ ...headerBtn }}
              >
                {MONTHS_SHORT[viewMonth]} {viewYear}
              </button>
            )}
            {viewMode === 'months' && (
              <button
                type="button"
                onClick={() => { setYearPage(Math.floor(viewYear / 12) * 12); setViewMode('years'); }}
                style={{ ...headerBtn }}
              >
                {viewYear}
              </button>
            )}
            {viewMode === 'years' && (
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>
                {yearStart} — {yearEnd}
              </span>
            )}

            <button
              onClick={() => {
                if (viewMode === 'days') nextMonth();
                else if (viewMode === 'years') setYearPage(p => p + 12);
                else { setViewYear(y => y + 1); }
              }}
              type="button" style={navBtn}
            >›</button>
          </div>

          {/* ── DAYS view ── */}
          {viewMode === 'days' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
                {DAYS_SHORT.map(d => (
                  <div key={d} style={{
                    textAlign: 'center', fontSize: 9, fontWeight: 700,
                    color: 'var(--text3, #64748b)', padding: '1px 0', textTransform: 'uppercase',
                  }}>{d}</div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
                {cells.map((day, i) => {
                  if (day === null) return <div key={`e${i}`} />;
                  const key = toKey(viewYear, viewMonth, day);
                  const isToday = key === todayKey;
                  const isSelected = key === selectedKey;
                  const isOff = isDisabledDate(key);
                  return (
                    <button
                      key={key} type="button" disabled={isOff}
                      onClick={() => selectDay(day)}
                      style={{
                        width: '100%', height: 26, border: 'none', borderRadius: 4,
                        fontSize: 11, fontWeight: isSelected || isToday ? 700 : 400,
                        cursor: isOff ? 'not-allowed' : 'pointer',
                        background: isSelected ? '#3b82f6' : isToday ? 'rgba(59,130,246,0.15)' : 'transparent',
                        color: isOff ? 'var(--text3, #64748b)' : isSelected ? '#fff' : 'var(--text, #f1f5f9)',
                        opacity: isOff ? 0.4 : 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'inherit', transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => {
                        if (!isSelected && !isOff) (e.target as HTMLElement).style.background = 'rgba(59,130,246,0.1)';
                      }}
                      onMouseLeave={e => {
                        if (!isSelected) (e.target as HTMLElement).style.background = isToday ? 'rgba(59,130,246,0.15)' : 'transparent';
                      }}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* ── MONTHS view ── */}
          {viewMode === 'months' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, padding: '4px 0' }}>
              {MONTHS_SHORT.map((m, idx) => {
                const isCurrent = idx === viewMonth && viewYear === (parsed?.getFullYear() ?? -1);
                return (
                  <button
                    key={m} type="button"
                    onClick={() => { setViewMonth(idx); setViewMode('days'); }}
                    style={{
                      padding: '6px 2px', border: 'none', borderRadius: 4,
                      fontSize: 11, fontWeight: isCurrent ? 700 : 500,
                      cursor: 'pointer', fontFamily: 'inherit',
                      background: isCurrent ? '#3b82f6' : 'transparent',
                      color: isCurrent ? '#fff' : 'var(--text, #f1f5f9)',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { if (!isCurrent) (e.target as HTMLElement).style.background = 'rgba(59,130,246,0.1)'; }}
                    onMouseLeave={e => { if (!isCurrent) (e.target as HTMLElement).style.background = 'transparent'; }}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          )}

          {/* ── YEARS view ── */}
          {viewMode === 'years' && (
            <div ref={yearGridRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, padding: '4px 0' }}>
              {Array.from({ length: 12 }, (_, i) => yearStart + i).map(y => {
                const isCurrent = y === viewYear;
                const isThisYear = y === currentYear;
                return (
                  <button
                    key={y} type="button"
                    onClick={() => { setViewYear(y); setViewMode('months'); }}
                    style={{
                      padding: '6px 2px', border: 'none', borderRadius: 4,
                      fontSize: 11, fontWeight: isCurrent || isThisYear ? 700 : 500,
                      cursor: 'pointer', fontFamily: 'inherit',
                      background: isCurrent ? '#3b82f6' : isThisYear ? 'rgba(59,130,246,0.15)' : 'transparent',
                      color: isCurrent ? '#fff' : 'var(--text, #f1f5f9)',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { if (!isCurrent) (e.target as HTMLElement).style.background = 'rgba(59,130,246,0.1)'; }}
                    onMouseLeave={e => { if (!isCurrent) (e.target as HTMLElement).style.background = isThisYear ? 'rgba(59,130,246,0.15)' : 'transparent'; }}
                  >
                    {y}
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Footer: Clear / Today ── */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border, #475569)' }}>
            <button
              type="button"
              onClick={() => { onChange({ target: { value: '' } }); setOpen(false); }}
              style={{ ...linkBtn, color: 'var(--text3, #64748b)' }}
            >Clear</button>
            <button
              type="button"
              onClick={() => {
                onChange({ target: { value: todayKey } });
                setViewYear(today.getFullYear());
                setViewMonth(today.getMonth());
                setOpen(false);
              }}
              style={{ ...linkBtn, color: '#3b82f6' }}
            >Today</button>
          </div>
        </div>
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = {
  width: 24, height: 24, borderRadius: 4, border: '1px solid var(--border, #475569)',
  background: 'transparent', color: 'var(--text, #f1f5f9)', fontSize: 14, fontWeight: 700,
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'inherit',
};

const headerBtn: React.CSSProperties = {
  background: 'none', border: 'none', fontSize: 12, fontWeight: 700,
  color: 'var(--text, #f1f5f9)', cursor: 'pointer', padding: '2px 8px',
  borderRadius: 4, fontFamily: 'inherit', transition: 'background 0.1s',
};

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', fontSize: 10, fontWeight: 600,
  cursor: 'pointer', padding: '2px 6px', borderRadius: 4, fontFamily: 'inherit',
};
