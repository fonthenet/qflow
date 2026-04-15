import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Custom DatePicker — replaces native <input type="date"> with a themed
 * calendar dropdown that matches the dark/light theme via CSS variables.
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

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function firstDayOfWeek(year: number, month: number): number {
  // Use UTC noon to avoid local timezone shifting the day
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

export default function DatePicker({ value, onChange, min, max, disabled, style, placeholder }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Parse current value or default to today's month
  const parsed = value ? new Date(value + 'T00:00:00') : null;
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? new Date().getMonth());

  // Sync view when value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value + 'T00:00:00');
      if (!isNaN(d.getTime())) {
        setViewYear(d.getFullYear());
        setViewMonth(d.getMonth());
      }
    }
  }, [value]);

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
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
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

  // Build grid cells
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  // Display value
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

      {/* Dropdown Calendar */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 9999,
          width: 280, padding: 12,
          background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #475569)',
          borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          {/* Month/Year nav */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button onClick={prevMonth} type="button" style={navBtn}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text, #f1f5f9)' }}>
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button onClick={nextMonth} type="button" style={navBtn}>›</button>
          </div>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {DAYS_SHORT.map(d => (
              <div key={d} style={{
                textAlign: 'center', fontSize: 10, fontWeight: 700,
                color: 'var(--text3, #64748b)', padding: '2px 0', textTransform: 'uppercase',
              }}>{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {cells.map((day, i) => {
              if (day === null) return <div key={`e${i}`} />;
              const key = toKey(viewYear, viewMonth, day);
              const isToday = key === todayKey;
              const isSelected = key === selectedKey;
              const isOff = isDisabledDate(key);
              return (
                <button
                  key={key}
                  type="button"
                  disabled={isOff}
                  onClick={() => selectDay(day)}
                  style={{
                    width: '100%', aspectRatio: '1', border: 'none', borderRadius: 6,
                    fontSize: 12, fontWeight: isSelected || isToday ? 700 : 400,
                    cursor: isOff ? 'not-allowed' : 'pointer',
                    background: isSelected ? '#3b82f6' : isToday ? 'rgba(59,130,246,0.15)' : 'transparent',
                    color: isOff ? 'var(--text3, #64748b)' : isSelected ? '#fff' : 'var(--text, #f1f5f9)',
                    opacity: isOff ? 0.4 : 1,
                    transition: 'background 0.1s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'inherit',
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

          {/* Today shortcut */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border, #475569)' }}>
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
  width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border, #475569)',
  background: 'transparent', color: 'var(--text, #f1f5f9)', fontSize: 16, fontWeight: 700,
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'inherit',
};

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', fontSize: 11, fontWeight: 600,
  cursor: 'pointer', padding: '2px 6px', borderRadius: 4, fontFamily: 'inherit',
};
