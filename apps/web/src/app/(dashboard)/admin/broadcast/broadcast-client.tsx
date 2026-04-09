'use client';

import { useState, useTransition } from 'react';
import { Send, Save, Trash2, Pencil, X, Check } from 'lucide-react';
import {
  saveBroadcastTemplate,
  deleteBroadcastTemplate,
  sendBroadcast,
} from '@/lib/actions/broadcast-actions';
import { useI18n } from '@/components/providers/locale-provider';

interface BroadcastTemplate {
  id: string;
  title: string;
  body_fr?: string | null;
  body_ar?: string | null;
  body_en?: string | null;
  created_at?: string;
}

interface Office {
  id: string;
  name: string;
}

interface BroadcastClientProps {
  initialTemplates: BroadcastTemplate[];
  offices: Office[];
}

const LANGS = [
  { key: 'fr', label: 'FR' },
  { key: 'ar', label: 'AR' },
] as const;

type LangKey = 'fr' | 'ar' | 'en';

export default function BroadcastClient({
  initialTemplates,
  offices,
}: BroadcastClientProps) {
  const { t } = useI18n();
  const [isPending, startTransition] = useTransition();

  // Send Broadcast state
  const [activeLang, setActiveLang] = useState<LangKey>('fr');
  const [bodies, setBodies] = useState<Record<LangKey, string>>({
    fr: '',
    ar: '',
    en: '',
  });
  const [selectedOffice, setSelectedOffice] = useState<string>('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateTitle, setTemplateTitle] = useState('');
  const [sendResult, setSendResult] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Templates state
  const [templates, setTemplates] = useState<BroadcastTemplate[]>(initialTemplates);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBodies, setEditBodies] = useState<Record<LangKey, string>>({
    fr: '',
    ar: '',
    en: '',
  });
  const [editLang, setEditLang] = useState<LangKey>('fr');

  // Status messages
  const [templateMsg, setTemplateMsg] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  function getActiveBody(): string {
    // Return the body for the active language, or fall back to first non-empty
    return (
      bodies[activeLang] ||
      bodies.fr ||
      bodies.ar ||
      bodies.en ||
      ''
    );
  }

  function handleSend() {
    const message = getActiveBody().trim();
    if (!message) return;

    setSendResult(null);
    startTransition(async () => {
      const result = await sendBroadcast({
        message,
        officeId: selectedOffice || undefined,
      });
      if (result.error) {
        setSendResult({ type: 'error', message: result.error });
      } else {
        setSendResult({
          type: 'success',
          message: `Broadcast sent to ${result.sent ?? 0} visitor(s).`,
        });
      }
    });
  }

  function handleSaveTemplate() {
    if (!templateTitle.trim()) return;
    startTransition(async () => {
      const result = await saveBroadcastTemplate({
        title: templateTitle.trim(),
        body_fr: bodies.fr || undefined,
        body_ar: bodies.ar || undefined,
        body_en: bodies.en || undefined,
      });
      if (result.error) {
        setTemplateMsg({ type: 'error', message: result.error });
      } else {
        setTemplateMsg({ type: 'success', message: 'Template saved.' });
        setTemplateTitle('');
        setSaveAsTemplate(false);
        // Refresh templates
        const mod = await import('@/lib/actions/broadcast-actions');
        const { templates: refreshed } = await mod.getBroadcastTemplates();
        setTemplates(refreshed ?? []);
      }
    });
  }

  function handleSendTemplate(tpl: BroadcastTemplate) {
    const message =
      tpl.body_fr || tpl.body_ar || tpl.body_en || '';
    if (!message.trim()) return;

    setSendResult(null);
    startTransition(async () => {
      const result = await sendBroadcast({
        message: message.trim(),
        officeId: selectedOffice || undefined,
        templateId: tpl.id,
      });
      if (result.error) {
        setSendResult({ type: 'error', message: result.error });
      } else {
        setSendResult({
          type: 'success',
          message: `Broadcast sent to ${result.sent ?? 0} visitor(s).`,
        });
      }
    });
  }

  function startEditing(tpl: BroadcastTemplate) {
    setEditingId(tpl.id);
    setEditTitle(tpl.title);
    setEditBodies({
      fr: tpl.body_fr ?? '',
      ar: tpl.body_ar ?? '',
      en: tpl.body_en ?? '',
    });
    setEditLang('fr');
  }

  function handleUpdateTemplate() {
    if (!editingId || !editTitle.trim()) return;
    startTransition(async () => {
      const result = await saveBroadcastTemplate({
        id: editingId!,
        title: editTitle.trim(),
        body_fr: editBodies.fr || undefined,
        body_ar: editBodies.ar || undefined,
        body_en: editBodies.en || undefined,
      });
      if (result.error) {
        setTemplateMsg({ type: 'error', message: result.error });
      } else {
        setTemplateMsg({ type: 'success', message: 'Template updated.' });
        setEditingId(null);
        const mod = await import('@/lib/actions/broadcast-actions');
        const { templates: refreshed } = await mod.getBroadcastTemplates();
        setTemplates(refreshed ?? []);
      }
    });
  }

  function handleDeleteTemplate(id: string) {
    if (!confirm(t('Delete this template? This cannot be undone.'))) return;
    startTransition(async () => {
      const result = await deleteBroadcastTemplate(id);
      if (result.error) {
        setTemplateMsg({ type: 'error', message: result.error });
      } else {
        setTemplates((prev) => prev.filter((t) => t.id !== id));
        setTemplateMsg({ type: 'success', message: 'Template deleted.' });
      }
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('Broadcast')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('Send messages to all visitors currently waiting in queue.')}
        </p>
      </div>

      {/* Send Broadcast Card */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">{t('Send Broadcast')}</h2>

        {/* Language tabs */}
        <div className="flex gap-1 mb-3">
          {LANGS.map((lang) => (
            <button
              key={lang.key}
              onClick={() => setActiveLang(lang.key)}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                activeLang === lang.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>

        {/* Textarea for each language (show active) */}
        {LANGS.map((lang) => (
          <div
            key={lang.key}
            className={activeLang === lang.key ? '' : 'hidden'}
          >
            <textarea
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[100px] resize-y"
              placeholder={`${t('Message')} (${lang.label})...`}
              value={bodies[lang.key]}
              onChange={(e) =>
                setBodies((prev) => ({ ...prev, [lang.key]: e.target.value }))
              }
              dir={lang.key === 'ar' ? 'rtl' : 'ltr'}
            />
          </div>
        ))}

        {/* Office filter */}
        <div className="mt-4">
          <label className="block text-sm font-medium text-foreground mb-1">
            {t('Office filter')}
          </label>
          <select
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={selectedOffice}
            onChange={(e) => setSelectedOffice(e.target.value)}
          >
            <option value="">{t('All offices')}</option>
            {offices.map((office) => (
              <option key={office.id} value={office.id}>
                {office.name}
              </option>
            ))}
          </select>
        </div>

        {/* Save as template toggle */}
        <div className="mt-4 flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={saveAsTemplate}
              onChange={(e) => setSaveAsTemplate(e.target.checked)}
              className="rounded border-input"
            />
            {t('Save as template')}
          </label>
          {saveAsTemplate && (
            <input
              type="text"
              className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={t('Template title...')}
              value={templateTitle}
              onChange={(e) => setTemplateTitle(e.target.value)}
            />
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleSend}
            disabled={isPending || !getActiveBody().trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Send className="h-4 w-4" />
            {isPending ? t('Sending...') : t('Send to All Waiting')}
          </button>
          {saveAsTemplate && (
            <button
              onClick={handleSaveTemplate}
              disabled={isPending || !templateTitle.trim()}
              className="inline-flex items-center gap-2 rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {t('Save Template')}
            </button>
          )}
        </div>

        {/* Result display */}
        {sendResult && (
          <div
            className={`mt-4 rounded-lg px-4 py-3 text-sm ${
              sendResult.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {sendResult.message}
          </div>
        )}
      </div>

      {/* Saved Templates Card */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">{t('Saved Templates')}</h2>

        {templateMsg && (
          <div
            className={`mb-4 rounded-lg px-4 py-3 text-sm ${
              templateMsg.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {templateMsg.message}
          </div>
        )}

        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('No saved templates yet. Send a broadcast and check "Save as template" to create one.')}
          </p>
        ) : (
          <div className="space-y-3">
            {templates.map((tpl) =>
              editingId === tpl.id ? (
                /* Inline edit */
                <div
                  key={tpl.id}
                  className="rounded-lg border border-primary/30 bg-primary/5 p-4"
                >
                  <input
                    type="text"
                    className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium mb-3 focus:outline-none focus:ring-2 focus:ring-ring"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                  <div className="flex gap-1 mb-2">
                    {LANGS.map((lang) => (
                      <button
                        key={lang.key}
                        onClick={() => setEditLang(lang.key)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                          editLang === lang.key
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        {lang.label}
                      </button>
                    ))}
                  </div>
                  {LANGS.map((lang) => (
                    <div
                      key={lang.key}
                      className={editLang === lang.key ? '' : 'hidden'}
                    >
                      <textarea
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                        value={editBodies[lang.key]}
                        onChange={(e) =>
                          setEditBodies((prev) => ({
                            ...prev,
                            [lang.key]: e.target.value,
                          }))
                        }
                        dir={lang.key === 'ar' ? 'rtl' : 'ltr'}
                      />
                    </div>
                  ))}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={handleUpdateTemplate}
                      disabled={isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {t('Save')}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                      {t('Cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                /* Template row */
                <div
                  key={tpl.id}
                  className="flex items-start justify-between gap-4 rounded-lg border border-border p-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{tpl.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      {tpl.body_fr || tpl.body_ar || tpl.body_en || '(empty)'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleSendTemplate(tpl)}
                      disabled={isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      title={t('Send')}
                    >
                      <Send className="h-3.5 w-3.5" />
                      {t('Send')}
                    </button>
                    <button
                      onClick={() => startEditing(tpl)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                      title={t('Edit')}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(tpl.id)}
                      disabled={isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                      title={t('Delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
