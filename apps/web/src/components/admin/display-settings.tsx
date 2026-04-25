'use client';

import { useState, useTransition } from 'react';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Save,
  CheckCircle2,
  ExternalLink,
  Plus,
  Trash2,
  Copy,
  Monitor,
  Settings,
  X,
} from 'lucide-react';
import {
  createDisplayScreen,
  updateDisplayScreen,
  deleteDisplayScreen,
} from '@/lib/actions/admin-actions';
import { useI18n } from '@/components/providers/locale-provider';
import { isRestaurantVertical } from '@qflo/shared';

interface Office {
  id: string;
  name: string;
  is_active: boolean;
}

interface Department {
  id: string;
  name: string;
  code: string;
  office_id: string;
  is_active: boolean;
}

interface DisplayScreen {
  id: string;
  office_id: string;
  name: string;
  screen_token: string;
  layout: string | null;
  settings: Record<string, any> | null;
  is_active: boolean;
}

interface DisplaysManagerProps {
  screens: DisplayScreen[];
  offices: Office[];
  departments: Department[];
  /** business_category from organizations.business_category or settings.business_category.
   *  Used to surface the Kitchen Display link for restaurant/cafe accounts. */
  businessCategory?: string | null;
}

export function DisplaysManager({ screens: initialScreens, offices, departments, businessCategory }: DisplaysManagerProps) {
  const { t } = useI18n();
  const [isPending, startTransition] = useTransition();
  const { confirm: styledConfirm } = useConfirmDialog();
  const [screens, setScreens] = useState(initialScreens);
  const [editingScreen, setEditingScreen] = useState<DisplayScreen | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newScreenName, setNewScreenName] = useState('');
  const [newScreenOfficeId, setNewScreenOfficeId] = useState(offices[0]?.id ?? '');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function showSuccess(msg: string) {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  }

  function handleCreate() {
    if (!newScreenName.trim() || !newScreenOfficeId) return;
    setErrorMessage(null);

    startTransition(async () => {
      const result = await createDisplayScreen(newScreenOfficeId, newScreenName.trim());
      if (result?.error) {
        setErrorMessage(result.error);
      } else if (result?.data) {
        setScreens((prev) => [...prev, result.data]);
        setNewScreenName('');
        setShowCreateForm(false);
        showSuccess(t('Display screen created.'));
      }
    });
  }

  async function handleDelete(screenId: string) {
    if (!await styledConfirm(t('Delete this display screen? This cannot be undone.'), { variant: 'danger', confirmLabel: 'Delete' })) return;
    setErrorMessage(null);

    startTransition(async () => {
      const result = await deleteDisplayScreen(screenId);
      if (result?.error) {
        setErrorMessage(result.error);
      } else {
        setScreens((prev) => prev.filter((s) => s.id !== screenId));
        if (editingScreen?.id === screenId) setEditingScreen(null);
        showSuccess(t('Display screen deleted.'));
      }
    });
  }

  function handleToggleActive(screen: DisplayScreen) {
    startTransition(async () => {
      const result = await updateDisplayScreen(screen.id, {
        is_active: !screen.is_active,
      });
      if (!result?.error) {
        setScreens((prev) =>
          prev.map((s) =>
            s.id === screen.id ? { ...s, is_active: !s.is_active } : s
          )
        );
      }
    });
  }

  function copyUrl(screenToken: string, screenId: string) {
    const url = `${window.location.origin}/d/${screenToken}`;
    navigator.clipboard.writeText(url);
    setCopiedId(screenId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function getOfficeName(officeId: string) {
    return offices.find((o) => o.id === officeId)?.name ?? t('Unknown');
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('Display Screens')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('Manage TV/monitor display screens for your offices.')}
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          {t('New Screen')}
        </button>
      </div>

      {/* Messages */}
      {successMessage && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <span className="text-sm text-green-700">{successMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <span className="text-sm text-red-700">{errorMessage}</span>
        </div>
      )}

      {/* Create form */}
      {showCreateForm && (
        <section className="rounded-xl border border-primary/30 bg-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">{t('Create New Display Screen')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                {t('Screen Name')}
              </label>
              <input
                type="text"
                value={newScreenName}
                onChange={(e) => setNewScreenName(e.target.value)}
                placeholder={t('e.g. Main Hall TV')}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                {t('Office')}
              </label>
              <select
                value={newScreenOfficeId}
                onChange={(e) => setNewScreenOfficeId(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {offices.map((office) => (
                  <option key={office.id} value={office.id}>
                    {office.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={isPending || !newScreenName.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Plus className="h-4 w-4" />
              {isPending ? t('Creating...') : t('Create Screen')}
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
            >
              {t('Cancel')}
            </button>
          </div>
        </section>
      )}

      {/* Screen list */}
      {screens.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <Monitor className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold text-foreground">{t('No display screens')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Create a display screen to show queue status on a TV or monitor.')}
          </p>
        </div>
      ) : (
        <div className={`grid gap-5 ${screens.length === 1 ? 'grid-cols-1 max-w-2xl' : screens.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
          {screens.map((screen) => (
            <div
              key={screen.id}
              className={`rounded-xl border bg-card shadow-sm transition-all ${
                screen.is_active ? 'border-border' : 'border-border/50 opacity-60'
              }`}
            >
              {/* Header band */}
              <div className={`flex items-center justify-between px-6 py-4 border-b ${
                screen.is_active ? 'border-border' : 'border-border/50'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    screen.is_active ? 'bg-primary/10' : 'bg-muted'
                  }`}>
                    <Monitor className={`h-5 w-5 ${screen.is_active ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-foreground">{screen.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {t('Office')}: {getOfficeName(screen.office_id)}
                    </p>
                  </div>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    screen.is_active
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {screen.is_active ? t('Active') : t('Inactive')}
                </span>
              </div>

              {/* URL preview */}
              <div className="px-6 py-3 bg-muted/30">
                <p className="text-xs text-muted-foreground font-mono truncate">
                  {typeof window !== 'undefined' ? window.location.origin : ''}/d/{screen.screen_token}
                </p>
              </div>

              {/* Actions */}
              <div className="px-6 py-4 flex flex-wrap gap-2">
                <a
                  href={`/d/${screen.screen_token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                >
                  <ExternalLink className="h-4 w-4" />
                  {t('Preview')}
                </a>
                {/* Kitchen Display link — restaurant/cafe vertical only */}
                {isRestaurantVertical(businessCategory) && (
                  <a
                    href={`/kitchen/${screen.screen_token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100 transition-colors dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-400 dark:hover:bg-orange-950/50"
                  >
                    <Monitor className="h-4 w-4" />
                    {t('Kitchen Display')}
                  </a>
                )}
                <button
                  onClick={() => copyUrl(screen.screen_token, screen.id)}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                >
                  <Copy className="h-4 w-4" />
                  {copiedId === screen.id ? t('Copied!') : t('Copy URL')}
                </button>
                <button
                  onClick={() => setEditingScreen(screen)}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                >
                  <Settings className="h-4 w-4" />
                  {t('Settings')}
                </button>
                <button
                  onClick={() => handleToggleActive(screen)}
                  disabled={isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                >
                  {screen.is_active ? t('Deactivate') : t('Activate')}
                </button>
                <button
                  onClick={() => handleDelete(screen.id)}
                  disabled={isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  {t('Delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Screen Settings Panel */}
      {editingScreen && (
        <ScreenSettingsPanel
          screen={editingScreen}
          departments={departments.filter((d) => d.office_id === editingScreen.office_id)}
          onClose={() => setEditingScreen(null)}
          onSaved={(updated) => {
            setScreens((prev) =>
              prev.map((s) => (s.id === updated.id ? updated : s))
            );
            setEditingScreen(null);
            showSuccess(t('Display settings saved.'));
          }}
        />
      )}
    </div>
  );
}

// ─── Screen Settings Panel ──────────────────────────────────────────────

interface ScreenSettingsPanelProps {
  screen: DisplayScreen;
  departments: Department[];
  onClose: () => void;
  onSaved: (updated: DisplayScreen) => void;
}

function ScreenSettingsPanel({ screen, departments, onClose, onSaved }: ScreenSettingsPanelProps) {
  const { t } = useI18n();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const s = screen.settings ?? {};

  // Settings state
  const [name, setName] = useState(screen.name);
  const [layout, setLayout] = useState<string>(screen.layout ?? s.layout ?? 'list');
  const [theme, setTheme] = useState<string>('light');
  const [bgColor, setBgColor] = useState<string>(
    typeof s.bg_color === 'string' && s.bg_color !== '#0a1628' && s.bg_color !== '#020617'
      ? s.bg_color
      : '#f8fafc'
  );
  const [accentColor, setAccentColor] = useState<string>(s.accent_color ?? '#3b82f6');
  const [textSize, setTextSize] = useState<string>(s.text_size ?? 'md');
  const [showClock, setShowClock] = useState<boolean>(s.show_clock ?? true);
  const [showNextUp, setShowNextUp] = useState<boolean>(s.show_next_up ?? true);
  const [showDeptBreakdown, setShowDeptBreakdown] = useState<boolean>(s.show_department_breakdown ?? true);
  const [showEstimatedWait, setShowEstimatedWait] = useState<boolean>(s.show_estimated_wait ?? false);
  const [maxTicketsShown, setMaxTicketsShown] = useState<number>(s.max_tickets_shown ?? 8);
  const [announcementSound, setAnnouncementSound] = useState<boolean>(s.announcement_sound ?? true);
  const [announcementDuration, setAnnouncementDuration] = useState<number>(s.announcement_duration ?? 8);
  const [autoScrollInterval, setAutoScrollInterval] = useState<number>(s.auto_scroll_interval ?? 10);
  const [visibleDeptIds, setVisibleDeptIds] = useState<string[]>(
    s.visible_department_ids ?? departments.map((d) => d.id)
  );

  function toggleDept(deptId: string) {
    setVisibleDeptIds((prev) =>
      prev.includes(deptId) ? prev.filter((d) => d !== deptId) : [...prev, deptId]
    );
  }

  function handleSave() {
    setErrorMessage(null);

    startTransition(async () => {
      const settings = {
        customized: true,
        layout,
        theme: 'light',
        bg_color: bgColor,
        accent_color: accentColor,
        text_size: textSize,
        show_clock: showClock,
        show_next_up: showNextUp,
        show_department_breakdown: showDeptBreakdown,
        show_estimated_wait: showEstimatedWait,
        max_tickets_shown: maxTicketsShown,
        announcement_sound: announcementSound,
        announcement_duration: announcementDuration,
        auto_scroll_interval: autoScrollInterval,
        visible_department_ids: visibleDeptIds,
      };

      const result = await updateDisplayScreen(screen.id, {
        name,
        layout,
        settings,
      });

      if (result?.error) {
        setErrorMessage(result.error);
      } else {
        onSaved({ ...screen, name, layout, settings });
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/30">
      <div className="h-full w-full max-w-lg overflow-y-auto bg-card border-l border-border shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t('Screen Settings')}: {screen.name}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-6">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              {t('Screen Name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Layout */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              {t('Layout')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'list', label: t('List') },
                { value: 'grid', label: t('Grid') },
                { value: 'department_split', label: t('Dept Split') },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setLayout(opt.value)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    layout === opt.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Appearance */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t('Appearance')}</h3>

            <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
              {t('Display theme is standardized to the light board experience.')}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  {t('Background Color')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded border border-border"
                  />
                  <input
                    type="text"
                    value={bgColor}
                    onChange={(e) => setBgColor(e.target.value)}
                    className="w-full rounded border border-border bg-card px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  {t('Accent Color')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded border border-border"
                  />
                  <input
                    type="text"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="w-full rounded border border-border bg-card px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('Text Size (for TV distance)')}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'sm', label: t('Small') },
                  { value: 'md', label: t('Medium') },
                  { value: 'lg', label: t('Large') },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTextSize(opt.value)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      textSize === opt.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showClock}
                onChange={(e) => setShowClock(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
              />
              <span className="text-sm text-foreground">{t('Show Clock')}</span>
            </label>
          </section>

          {/* Content */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t('Content')}</h3>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showNextUp}
                onChange={(e) => setShowNextUp(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
              />
              <span className="text-sm text-foreground">{t('Show "Next Up" queue list')}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showDeptBreakdown}
                onChange={(e) => setShowDeptBreakdown(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
              />
              <span className="text-sm text-foreground">{t('Show department breakdown')}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showEstimatedWait}
                onChange={(e) => setShowEstimatedWait(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
              />
              <span className="text-sm text-foreground">{t('Show estimated wait times')}</span>
            </label>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('Max tickets shown in "Next Up"')}
              </label>
              <input
                type="number"
                min={3}
                max={30}
                value={maxTicketsShown}
                onChange={(e) => setMaxTicketsShown(Number(e.target.value))}
                className="w-24 rounded-lg border border-border bg-card px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </section>

          {/* Behavior */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t('Behavior')}</h3>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={announcementSound}
                onChange={(e) => setAnnouncementSound(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
              />
              <span className="text-sm text-foreground">{t('Play announcement sound')}</span>
            </label>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('Announcement Duration (seconds)')}
              </label>
              <input
                type="number"
                min={3}
                max={30}
                value={announcementDuration}
                onChange={(e) => setAnnouncementDuration(Number(e.target.value))}
                className="w-24 rounded-lg border border-border bg-card px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                {t('Auto-scroll Interval (seconds)')}
              </label>
              <input
                type="number"
                min={5}
                max={60}
                value={autoScrollInterval}
                onChange={(e) => setAutoScrollInterval(Number(e.target.value))}
                className="w-24 rounded-lg border border-border bg-card px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </section>

          {/* Department Filter */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t('Visible Departments')}</h3>
            <p className="text-xs text-muted-foreground">
              {t('Select which departments this screen shows. Useful for multi-screen setups.')}
            </p>
            <div className="space-y-2">
              {departments.map((dept) => (
                <label key={dept.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={visibleDeptIds.includes(dept.id)}
                    onChange={() => toggleDept(dept.id)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
                  />
                  <span className="text-sm text-foreground">{dept.name}</span>
                  <span className="text-xs text-muted-foreground">({dept.code})</span>
                </label>
              ))}
            </div>
          </section>

          {/* Error */}
          {errorMessage && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <span className="text-sm text-red-700">{errorMessage}</span>
            </div>
          )}

          {/* Save */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Save className="h-4 w-4" />
              {isPending ? t('Saving...') : t('Save Settings')}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
            >
              {t('Cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
