import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Custom TimePicker — replaces native <input type="time"> with a themed
 * dropdown that matches the dark/light theme via CSS variables.
 *
 * Props mirror a standard time input: value, onChange, disabled, style.
 */

interface TimePickerProps {
  value: string; // HH:MM (24h)
  onChange: (e: { target: { value: string } }) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  step?: number; // minutes between options, default 15
  min?: string;  // HH:MM
  max?: string;  // HH:MM
}

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

function generateSlots(step: number, min?: string, max?: string): string[] {
  const slots: string[] = [];
  const minMin = min ? parseInt(min.split(':')[0]) * 60 + parseInt(min.split(':')[1]) : 0;
  const maxMin = max ? parseInt(max.split(':')[0]) * 60 + parseInt(max.split(':')[1]) : 23 * 60 + 59;
  for (let m = minMin; m <= maxMin; m += step) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h > 23) break;
    slots.push(`${pad(h)}:${pad(mm)}`);
  }
  return slots;
}

export default function TimePicker({ value, onChange, disabled, style, step = 15, min, max }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const slots = React.useMemo(() => generateSlots(step, min, max), [step, min, max]);

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

  // Scroll to selected time when dropdown opens
  useEffect(() => {
    if (open && listRef.current && value) {
      const idx = slots.indexOf(value);
      if (idx >= 0) {
        const el = listRef.current.children[idx] as HTMLElement;
        if (el) el.scrollIntoView({ block: 'center' });
      }
    }
  }, [open, value, slots]);

  const select = useCallback((slot: string) => {
    onChange({ target: { value: slot } });
    setOpen(false);
  }, [onChange]);

  // Display: show HH:MM
  const displayValue = value || '';

  const base: React.CSSProperties = {
    width: '100%', padding: '7px 10px', border: '1px solid var(--border, #475569)',
    borderRadius: 6, background: 'var(--bg, #0f172a)', color: 'var(--text, #f1f5f9)',
    fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1, position: 'relative' as const, fontFamily: 'inherit',
    ...style,
  };

  return (
    <div ref={ref} style={{ position: 'relative', width: style?.width ?? '100%', display: 'inline-block' }}>
      {/* Trigger */}
      <div
        onClick={() => { if (!disabled) setOpen(o => !o); }}
        style={base}
        tabIndex={0}
        role="combobox"
        aria-expanded={open}
      >
        <span style={{ color: displayValue ? 'var(--text, #f1f5f9)' : 'var(--text3, #64748b)' }}>
          {displayValue || 'Select time'}
        </span>
        <span style={{
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          fontSize: 11, color: 'var(--text3, #64748b)', pointerEvents: 'none',
        }}>🕐</span>
      </div>

      {/* Dropdown list */}
      {open && (
        <div
          ref={listRef}
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 9999,
            width: '100%', minWidth: 90, maxHeight: 220, overflowY: 'auto',
            background: 'var(--surface, #1e293b)', border: '1px solid var(--border, #475569)',
            borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            padding: '4px 0',
          }}
        >
          {slots.map(slot => {
            const isSelected = slot === value;
            return (
              <div
                key={slot}
                onClick={() => select(slot)}
                style={{
                  padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: isSelected ? 700 : 400,
                  background: isSelected ? '#3b82f6' : 'transparent',
                  color: isSelected ? '#fff' : 'var(--text, #f1f5f9)',
                  transition: 'background 0.1s',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => {
                  if (!isSelected) (e.target as HTMLElement).style.background = 'rgba(59,130,246,0.12)';
                }}
                onMouseLeave={e => {
                  if (!isSelected) (e.target as HTMLElement).style.background = 'transparent';
                }}
              >
                {slot}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
