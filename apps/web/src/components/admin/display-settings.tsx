'use client';

import { useState, useTransition } from 'react';
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
}

export function DisplaysManager({ screens: initialScreens, offices, departments }: DisplaysManagerProps) {
  const [isPending, startTransition] = useTransition();
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
        showSuccess('Display screen created.');
      }
    });
  }

  function handleDelete(screenId: string) {
    if (!confirm('Delete this display screen? This cannot be undone.')) return;
    setErrorMessage(null);

    startTransition(async () => {
      const result = await deleteDisplayScreen(screenId);
      if (result?.error) {
        setErrorMessage(result.error);
      } else {
        setScreens((prev) => prev.filter((s) => s.id !== screenId));
        if (editingScreen?.id === screenId) setEditingScreen(null);
        showSuccess('Display screen deleted.');
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
    const url = `${window.location.origin}/display/${screenToken}`;
    navigator.clipboard.writeText(url);
    setCopiedId(screenId);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function getOfficeName(officeId: string) {
    return offices.find((o) => o.id === officeId)?.name ?? 'Unknown';
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <section className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-5 border-b border-border px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              <Monitor className="h-3.5 w-3.5" />
              Displays
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Display Screens</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Manage TV/monitor display screens for your offices.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {successMessage && (
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                {successMessage}
              </span>
            )}
            {errorMessage && <span className="text-sm text-destructive">{errorMessage}</span>}
            <button
              onClick={() => setShowCreateForm(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              New Screen
            </button>
          </div>
        </div>

        <div className="grid gap-4 px-6 py-5 md:grid-cols-3">
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Monitor className="h-3.5 w-3.5" />
              Total screens
            </div>
            <p className="mt-2 text-2xl font-bold text-foreground">{screens.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Monitor className="h-3.5 w-3.5" />
              Active screens
            </div>
            <p className="mt-2 text-2xl font-bold text-foreground">{screens.filter((s) => s.is_active).length}</p>
          </div>
          <div className="rounded-xl border border-border bg-background px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Monitor className="h-3.5 w-3.5" />
              Offices covered
            </div>
            <p className="mt-2 text-2xl font-bold text-foreground">{new Set(screens.map((s) => s.office_id)).size}</p>
          </div>
        </div>
      </section>

      {/* Create form */}
      {showCreateForm && (
        <section className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground">Create New Display Screen</h2>
          </div>
          <div className="space-y-5 px-5 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Screen Name
                </label>
                <input
                  type="text"
                  value={newScreenName}
                  onChange={(e) => setNewScreenName(e.target.value)}
                  placeholder="e.g. Main Hall TV"
                  className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Office
                </label>
                <select
                  value={newScreenOfficeId}
                  onChange={(e) => setNewScreenOfficeId(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
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
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <Plus className="h-4 w-4" />
                {isPending ? 'Creating...' : 'Create Screen'}
              </button>
              <button
                onClick={() => setShowCreateForm(false)}
                className="rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Screen list */}
      {screens.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
            <Monitor className="h-7 w-7 text-primary" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-foreground">No display screens</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a display screen to show queue status on a TV or monitor.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {screens.map((screen) => (
            <div
              key={screen.id}
              className={`rounded-2xl border bg-card shadow-sm transition-all ${
                screen.is_active ? 'border-border' : 'border-border/50 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between border-b border-border px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <div className="rounded-xl bg-primary/10 p-2 text-primary">
                    <Monitor className="h-4 w-4" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">{screen.name}</h3>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    screen.is_active
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {screen.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Office</p>
                <p className="mt-1 text-sm text-foreground">{getOfficeName(screen.office_id)}</p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={`/display/${screen.screen_token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Preview
                  </a>
                  <button
                    onClick={() => copyUrl(screen.screen_token, screen.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copiedId === screen.id ? 'Copied!' : 'Copy URL'}
                  </button>
                  <button
                    onClick={() => setEditingScreen(screen)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Settings
                  </button>
                  <button
                    onClick={() => handleToggleActive(screen)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                  >
                    {screen.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => handleDelete(screen.id)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-background px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
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
            showSuccess('Display settings saved.');
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
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const s = screen.settings ?? {};

  // Settings state
  const [name, setName] = useState(screen.name);
  const [layout, setLayout] = useState<string>(screen.layout ?? s.layout ?? 'list');
  const [theme, setTheme] = useState<string>(s.theme ?? 'dark');
  const [bgColor, setBgColor] = useState<string>(s.bg_color ?? '#0a1628');
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
        layout,
        theme,
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
      <div className="h-full w-full max-w-lg overflow-y-auto rounded-l-2xl bg-card border-l border-border shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">
            Screen Settings: {screen.name}
          </h2>
          <button onClick={onClose} className="rounded-xl p-1.5 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-6">
          {/* Name */}
          <div className="space-y-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Screen Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Layout */}
          <div className="space-y-2">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Layout
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'list', label: 'List' },
                { value: 'grid', label: 'Grid' },
                { value: 'department_split', label: 'Dept Split' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setLayout(opt.value)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
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
          <section className="rounded-2xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <h3 className="text-base font-semibold text-foreground">Appearance</h3>
            </div>
            <div className="space-y-4 px-5 py-5">
              {/* Theme Mode */}
              <div className="space-y-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Theme Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      setTheme('dark');
                      setBgColor('#0a1628');
                      setAccentColor('#3b82f6');
                    }}
                    className={`rounded-xl border px-3 py-3 text-sm font-medium transition-colors flex items-center gap-2 ${
                      theme === 'dark'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    <span className="inline-block h-4 w-4 rounded-full bg-[#0a1628] border border-gray-400" />
                    Dark
                  </button>
                  <button
                    onClick={() => {
                      setTheme('light');
                      setBgColor('#f8fafc');
                      setAccentColor('#2563eb');
                    }}
                    className={`rounded-xl border px-3 py-3 text-sm font-medium transition-colors flex items-center gap-2 ${
                      theme === 'light'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    <span className="inline-block h-4 w-4 rounded-full bg-[#f8fafc] border border-gray-300" />
                    Light
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Background Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      className="h-11 w-14 cursor-pointer rounded-xl border border-border bg-background"
                    />
                    <input
                      type="text"
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-mono text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Accent Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="h-11 w-14 cursor-pointer rounded-xl border border-border bg-background"
                    />
                    <input
                      type="text"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-mono text-foreground outline-none transition focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Text Size (for TV distance)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'sm', label: 'Small' },
                    { value: 'md', label: 'Medium' },
                    { value: 'lg', label: 'Large' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setTextSize(opt.value)}
                      className={`rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors ${
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

              <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-sm font-medium text-foreground">Show Clock</p>
                <input
                  type="checkbox"
                  checked={showClock}
                  onChange={(e) => setShowClock(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
                />
              </div>
            </div>
          </section>

          {/* Content */}
          <section className="rounded-2xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <h3 className="text-base font-semibold text-foreground">Content</h3>
            </div>
            <div className="space-y-3 px-5 py-5">
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-sm font-medium text-foreground">Show &quot;Next Up&quot; queue list</p>
                <input
                  type="checkbox"
                  checked={showNextUp}
                  onChange={(e) => setShowNextUp(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-sm font-medium text-foreground">Show department breakdown</p>
                <input
                  type="checkbox"
                  checked={showDeptBreakdown}
                  onChange={(e) => setShowDeptBreakdown(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-sm font-medium text-foreground">Show estimated wait times</p>
                <input
                  type="checkbox"
                  checked={showEstimatedWait}
                  onChange={(e) => setShowEstimatedWait(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Max tickets shown in &quot;Next Up&quot;
                </label>
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={maxTicketsShown}
                  onChange={(e) => setMaxTicketsShown(Number(e.target.value))}
                  className="w-28 rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none transition focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
          </section>

          {/* Behavior */}
          <section className="rounded-2xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <h3 className="text-base font-semibold text-foreground">Behavior</h3>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
                <p className="text-sm font-medium text-foreground">Play announcement sound</p>
                <input
                  type="checkbox"
                  checked={announcementSound}
                  onChange={(e) => setAnnouncementSound(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Announcement Duration (seconds)
                </label>
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={announcementDuration}
                  onChange={(e) => setAnnouncementDuration(Number(e.target.value))}
                  className="w-28 rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none transition focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Auto-scroll Interval (seconds)
                </label>
                <input
                  type="number"
                  min={5}
                  max={60}
                  value={autoScrollInterval}
                  onChange={(e) => setAutoScrollInterval(Number(e.target.value))}
                  className="w-28 rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none transition focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
          </section>

          {/* Department Filter */}
          <section className="rounded-2xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <h3 className="text-base font-semibold text-foreground">Visible Departments</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Select which departments this screen shows. Useful for multi-screen setups.
              </p>
            </div>
            <div className="space-y-2 px-5 py-5">
              {departments.map((dept) => (
                <div key={dept.id} className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{dept.name}</span>
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">{dept.code}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={visibleDeptIds.includes(dept.id)}
                    onChange={() => toggleDept(dept.id)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary/50"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Error */}
          {errorMessage && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
              <span className="text-sm text-red-700">{errorMessage}</span>
            </div>
          )}

          {/* Save */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Save className="h-4 w-4" />
              {isPending ? 'Saving...' : 'Save Settings'}
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
