import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Word-like rich text editor built on contentEditable + execCommand.
 *
 * Why no library: the Station ships offline-first in Electron. Adding Tiptap /
 * Slate / Lexical would cost ~200 kB and extra render cost for a feature that
 * the browser's native editing engine already does well. execCommand is
 * deprecated on paper but shipped in every Chromium; Electron pins Chromium so
 * this won't silently vanish.
 *
 * The tricky part of an execCommand editor is selection preservation — when
 * the user clicks a toolbar button the selection inside the editor is lost
 * unless preventDefault runs early AND the last range is restored just before
 * exec. Both are implemented below.
 */

interface Props {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  minHeight?: number;
  /** Localizer. If omitted, English labels are used. */
  t?: (s: string) => string;
}

const BTN_STYLE: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  minWidth: 30, height: 30, padding: '0 6px',
  border: '1px solid transparent', borderRadius: 6,
  background: 'transparent', color: 'var(--text, #f1f5f9)',
  cursor: 'pointer', fontSize: 13, fontWeight: 600,
  userSelect: 'none',
};
const BTN_ACTIVE: React.CSSProperties = {
  background: 'rgba(59,130,246,0.15)', borderColor: 'rgba(59,130,246,0.35)',
  color: 'var(--primary, #3b82f6)',
};

const FONT_FAMILIES: Array<{ label: string; value: string }> = [
  { label: 'Default',         value: '' },
  { label: 'Sans Serif',      value: 'Arial, Helvetica, sans-serif' },
  { label: 'Serif',           value: 'Georgia, "Times New Roman", serif' },
  { label: 'Monospace',       value: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace' },
  { label: 'Inter',           value: 'Inter, system-ui, sans-serif' },
  { label: 'Arial',           value: 'Arial, sans-serif' },
  { label: 'Georgia',         value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier New',     value: '"Courier New", Courier, monospace' },
  { label: 'Tahoma',          value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Verdana',         value: 'Verdana, Geneva, sans-serif' },
];

// Pixel sizes surfaced to the user; stored via inline style on a <span>.
const FONT_SIZES_PX = [10, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48];

/** Strip inline background colors and dangerous nodes from pasted HTML. */
function sanitizePasted(html: string): string {
  const tmpl = document.createElement('template');
  tmpl.innerHTML = html;
  const root = tmpl.content;
  root.querySelectorAll('script, style, meta, link').forEach(n => n.remove());
  root.querySelectorAll<HTMLElement>('*').forEach(el => {
    [...el.attributes].forEach(a => {
      if (a.name.startsWith('on')) el.removeAttribute(a.name);
      if (a.name === 'style') {
        const keep = a.value
          .split(';')
          .map(s => s.trim())
          .filter(s => /^(font-weight|font-style|font-family|font-size|text-decoration|text-align|margin-left)\s*:/i.test(s))
          .join('; ');
        if (keep) el.setAttribute('style', keep);
        else el.removeAttribute('style');
      }
    });
  });
  return tmpl.innerHTML;
}

export function RichTextEditor({ value, onChange, disabled, placeholder, minHeight = 260, t }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [, force] = useState(0);
  const tr = useCallback((s: string) => (t ? t(s) : s), [t]);

  // Sync external value → DOM only when it actually differs (avoids wiping caret mid-edit).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerHTML !== (value || '')) {
      el.innerHTML = value || '';
    }
  }, [value]);

  // Track selection so clicking the toolbar can restore it before exec.
  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const el = ref.current;
      if (el && el.contains(range.commonAncestorContainer)) {
        savedRange.current = range.cloneRange();
        force(x => x + 1); // refresh active state
      }
    };
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, []);

  const restoreSelection = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    if (savedRange.current && el.contains(savedRange.current.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    } else {
      // No prior selection inside editor → put caret at end so exec has a target.
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      savedRange.current = range.cloneRange();
    }
  }, []);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    onChange(el.innerHTML);
    force(x => x + 1);
  }, [onChange]);

  const isActive = (cmd: string): boolean => {
    try { return document.queryCommandState(cmd); } catch { return false; }
  };
  const currentBlock = (): string => {
    try { return (document.queryCommandValue('formatBlock') || '').toLowerCase(); } catch { return ''; }
  };
  const currentFont = (): string => {
    try { return (document.queryCommandValue('fontName') || '').replace(/^["']|["']$/g, ''); } catch { return ''; }
  };

  const run = (cmd: string, arg?: string) => {
    restoreSelection();
    try { document.execCommand(cmd, false, arg); } catch { /* no-op */ }
    emit();
  };

  const setBlock = (tag: 'p' | 'h1' | 'h2' | 'h3' | 'blockquote') => {
    // Chromium accepts both "<h1>" and "h1"; wrap in angle brackets for Firefox parity.
    run('formatBlock', `<${tag}>`);
  };

  /** Wrap the current selection in a <span style="font-size: Xpx"> — more reliable
   * than the legacy fontSize 1-7 values and it gives us pixel precision. */
  const setFontSizePx = (px: number) => {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) {
      // No selection: inject a zero-width marker span so subsequent typing inherits the size.
      const span = document.createElement('span');
      span.style.fontSize = `${px}px`;
      span.appendChild(document.createTextNode('\u200B'));
      range.insertNode(span);
      const newRange = document.createRange();
      newRange.setStart(span.firstChild!, 1);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } else {
      // Use execCommand as a wrapper then post-process the generated <font size> → inline style.
      document.execCommand('fontSize', false, '7');
      const el = ref.current;
      el?.querySelectorAll<HTMLElement>('font[size="7"]').forEach(f => {
        const span = document.createElement('span');
        span.style.fontSize = `${px}px`;
        while (f.firstChild) span.appendChild(f.firstChild);
        f.replaceWith(span);
      });
    }
    emit();
  };

  const setFontFamily = (family: string) => {
    if (!family) { run('removeFormat'); return; }
    // fontName is well supported and wraps selection in <font face=...>. We'll
    // leave the <font> tag; it renders fine. For stricter HTML, could post-process.
    run('fontName', family);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    e.preventDefault();
    restoreSelection();
    if (html) {
      document.execCommand('insertHTML', false, sanitizePasted(html));
    } else if (text) {
      document.execCommand(
        'insertHTML',
        false,
        text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'),
      );
    }
    emit();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) { e.preventDefault(); return; }
    const meta = e.ctrlKey || e.metaKey;
    if (!meta) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); run('bold'); }
    else if (k === 'i') { e.preventDefault(); run('italic'); }
    else if (k === 'u') { e.preventDefault(); run('underline'); }
    else if (k === 'z') { e.preventDefault(); run(e.shiftKey ? 'redo' : 'undo'); }
    else if (k === 'y') { e.preventDefault(); run('redo'); }
  };

  const insertLink = () => {
    const url = window.prompt(tr('Paste link URL (http/https):'), 'https://');
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) { window.alert(tr('Only http(s) links are supported.')); return; }
    run('createLink', url);
    ref.current?.querySelectorAll('a').forEach(a => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
    emit();
  };

  const block = currentBlock();
  const currentFam = currentFont();

  const ToolBtn = ({
    onClick, active, title, children,
  }: {
    onClick: () => void; active?: boolean; title: string; children: React.ReactNode;
  }) => (
    <button
      type="button"
      // preventDefault on pointerdown is the earliest, most reliable way to stop
      // the browser from moving focus out of the editor before we can restore it.
      onPointerDown={e => e.preventDefault()}
      onMouseDown={e => e.preventDefault()}
      onClick={e => { e.preventDefault(); onClick(); }}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{ ...BTN_STYLE, ...(active ? BTN_ACTIVE : null), opacity: disabled ? 0.5 : 1 }}
    >
      {children}
    </button>
  );

  const Sep = () => (
    <span aria-hidden style={{
      display: 'inline-block', width: 1, height: 20, marginInline: 4,
      background: 'var(--border, #475569)',
    }} />
  );

  const selectBase: React.CSSProperties = {
    height: 30, padding: '0 6px', borderRadius: 6,
    border: '1px solid var(--border, #475569)',
    background: 'var(--bg, #0f172a)', color: 'var(--text, #f1f5f9)',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
    colorScheme: 'light dark',
  };

  return (
    <div
      style={{
        border: '1px solid var(--border, #475569)',
        borderRadius: 8,
        background: 'var(--bg, #0f172a)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        colorScheme: 'light dark',
        // Let the user drag the bottom-right corner to make the editor taller.
        // `resize` requires overflow != visible (we set hidden above) and a
        // definite height (set here; minHeight keeps a sane floor).
        resize: 'vertical',
        height: minHeight + 46 /* toolbar (~46px) + editor min */,
        minHeight: minHeight + 46,
      }}
    >
      {/* Toolbar */}
      <div
        onPointerDown={e => {
          // Any click in the toolbar gutter (between buttons) must not steal focus.
          if ((e.target as HTMLElement).tagName === 'DIV') e.preventDefault();
        }}
        style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2,
          padding: '6px 8px',
          borderBottom: '1px solid var(--border, #475569)',
          background: 'var(--surface, #1e293b)',
          position: 'sticky', top: 0, zIndex: 1,
        }}
      >
        {/* Block style. NOTE: no preventDefault on pointer/mousedown — Chromium
            blocks the native <select> dropdown from opening if we do. The
            selectionchange listener already saves the editor range before the
            select is ever focused, so restoreSelection() on change still works. */}
        <select
          value={['h1','h2','h3','blockquote'].includes(block) ? block : 'p'}
          onChange={e => setBlock(e.target.value as any)}
          disabled={disabled}
          style={selectBase}
          title={tr('Paragraph style')}
        >
          <option value="p">{tr('Paragraph')}</option>
          <option value="h1">{tr('Heading 1')}</option>
          <option value="h2">{tr('Heading 2')}</option>
          <option value="h3">{tr('Heading 3')}</option>
          <option value="blockquote">{tr('Quote')}</option>
        </select>

        {/* Font family */}
        <select
          value={FONT_FAMILIES.find(f => currentFam && f.value.toLowerCase().startsWith(currentFam.toLowerCase()))?.value ?? ''}
          onChange={e => setFontFamily(e.target.value)}
          disabled={disabled}
          style={{ ...selectBase, minWidth: 130 }}
          title={tr('Font')}
        >
          {FONT_FAMILIES.map(f => (
            <option key={f.label} value={f.value} style={{ fontFamily: f.value || undefined }}>
              {f.label}
            </option>
          ))}
        </select>

        {/* Font size */}
        <select
          defaultValue=""
          onChange={e => { const v = parseInt(e.target.value, 10); if (v) setFontSizePx(v); e.currentTarget.value = ''; }}
          disabled={disabled}
          style={{ ...selectBase, minWidth: 72 }}
          title={tr('Font size')}
        >
          <option value="">{tr('Size')}</option>
          {FONT_SIZES_PX.map(px => (
            <option key={px} value={px}>{px}px</option>
          ))}
        </select>
        <Sep />

        <ToolBtn onClick={() => run('bold')}   active={isActive('bold')}   title={tr('Bold (Ctrl+B)')}>
          <b>B</b>
        </ToolBtn>
        <ToolBtn onClick={() => run('italic')} active={isActive('italic')} title={tr('Italic (Ctrl+I)')}>
          <i>I</i>
        </ToolBtn>
        <ToolBtn onClick={() => run('underline')} active={isActive('underline')} title={tr('Underline (Ctrl+U)')}>
          <span style={{ textDecoration: 'underline' }}>U</span>
        </ToolBtn>
        <ToolBtn onClick={() => run('strikeThrough')} active={isActive('strikeThrough')} title={tr('Strikethrough')}>
          <span style={{ textDecoration: 'line-through' }}>S</span>
        </ToolBtn>
        <Sep />

        <ToolBtn onClick={() => run('insertUnorderedList')} active={isActive('insertUnorderedList')} title={tr('Bulleted list')}>
          •≡
        </ToolBtn>
        <ToolBtn onClick={() => run('insertOrderedList')} active={isActive('insertOrderedList')} title={tr('Numbered list')}>
          1.≡
        </ToolBtn>
        <Sep />

        <ToolBtn onClick={() => run('justifyLeft')}   active={isActive('justifyLeft')}   title={tr('Align left')}>⟸</ToolBtn>
        <ToolBtn onClick={() => run('justifyCenter')} active={isActive('justifyCenter')} title={tr('Align center')}>≡</ToolBtn>
        <ToolBtn onClick={() => run('justifyRight')}  active={isActive('justifyRight')}  title={tr('Align right')}>⟹</ToolBtn>
        <Sep />

        <ToolBtn onClick={insertLink} title={tr('Insert link')}>🔗</ToolBtn>
        <ToolBtn onClick={() => run('removeFormat')} title={tr('Clear formatting')}>⨯</ToolBtn>
      </div>

      {/* Editable surface */}
      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        onKeyDown={onKeyDown}
        onKeyUp={() => force(x => x + 1)}
        onMouseUp={() => force(x => x + 1)}
        onPaste={onPaste}
        data-placeholder={placeholder || ''}
        role="textbox"
        aria-multiline="true"
        spellCheck
        style={{
          flex: 1, minHeight,
          padding: '12px 14px',
          outline: 'none',
          color: 'var(--text, #f1f5f9)',
          fontSize: 14, lineHeight: 1.55,
          overflowY: 'auto',
          whiteSpace: 'pre-wrap', wordWrap: 'break-word',
        }}
      />

      {/* Placeholder + block styles */}
      <style>{`
        [contenteditable][data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: var(--text3, #64748b);
          pointer-events: none;
        }
        [contenteditable] h1 { font-size: 1.6em; font-weight: 700; margin: 0.6em 0 0.3em; }
        [contenteditable] h2 { font-size: 1.35em; font-weight: 700; margin: 0.6em 0 0.3em; }
        [contenteditable] h3 { font-size: 1.15em; font-weight: 600; margin: 0.6em 0 0.3em; }
        [contenteditable] blockquote {
          margin: 0.6em 0; padding: 6px 12px;
          border-inline-start: 3px solid var(--primary, #3b82f6);
          color: var(--text2, #94a3b8);
          background: rgba(59,130,246,0.06);
          border-radius: 4px;
        }
        [contenteditable] ul, [contenteditable] ol { padding-inline-start: 1.6em; margin: 0.5em 0; }
        [contenteditable] li { margin: 0.15em 0; }
        [contenteditable] a { color: var(--primary, #3b82f6); text-decoration: underline; }
        [contenteditable] p { margin: 0.35em 0; }
      `}</style>
    </div>
  );
}
