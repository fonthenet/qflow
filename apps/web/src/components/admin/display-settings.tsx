'use client';

import { useState, useTransition } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  Monitor,
  Play,
  Plus,
  Save,
  Settings,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import {
  createDisplayScreen,
  updateDisplayScreen,
  deleteDisplayScreen,
} from '@/lib/actions/admin-actions';
import { DisplayBoard, VOICE_PRESETS, speakAnnouncement } from '@/components/display/display-board';

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
  organization?: { name: string; logo_url?: string | null };
}

export function DisplaysManager({ screens: initialScreens, offices, departments, organization }: DisplaysManagerProps) {
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

  // ─── Full-page editor mode ──────────────────────────────────────────────
  if (editingScreen) {
    return (
      <ScreenEditor
        screen={editingScreen}
        departments={departments.filter((d) => d.office_id === editingScreen.office_id)}
        offices={offices}
        organization={organization}
        onClose={() => setEditingScreen(null)}
        onSaved={(updated) => {
          setScreens((prev) =>
            prev.map((s) => (s.id === updated.id ? updated : s))
          );
          setEditingScreen(null);
          showSuccess('Display settings saved.');
        }}
      />
    );
  }

  // ─── Screen list view ──────────────────────────────────────────────────
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
                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 text-xs font-medium hover:bg-primary/20 transition-colors"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Live Editor
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
    </div>
  );
}

// ─── Mock data for live preview ──────────────────────────────────────────

function buildMockData(departments: Department[]) {
  const dept1 = departments[0];
  const dept2 = departments[1] ?? departments[0];

  const activeTickets = [
    {
      id: 'preview-1',
      ticket_number: 'A-105',
      status: 'serving',
      department_id: dept1?.id ?? 'dept-1',
      called_at: new Date(Date.now() - 240000).toISOString(),
      serving_started_at: new Date(Date.now() - 180000).toISOString(),
      desk: { name: 'Counter 1', display_name: 'Counter 1' },
      service: { name: 'General Inquiry' },
      department: { name: dept1?.name ?? 'General', code: dept1?.code ?? 'GEN' },
    },
    {
      id: 'preview-2',
      ticket_number: 'B-042',
      status: 'called',
      department_id: dept2?.id ?? 'dept-2',
      called_at: new Date(Date.now() - 15000).toISOString(),
      serving_started_at: null,
      desk: { name: 'Counter 2', display_name: 'Counter 2' },
      service: { name: 'Account Services' },
      department: { name: dept2?.name ?? 'Support', code: dept2?.code ?? 'SUP' },
    },
  ];

  const waitingTickets = [
    { id: 'w1', department_id: dept1?.id ?? 'dept-1', ticket_number: 'A-106', created_at: new Date(Date.now() - 600000).toISOString() },
    { id: 'w2', department_id: dept1?.id ?? 'dept-1', ticket_number: 'A-107', created_at: new Date(Date.now() - 300000).toISOString() },
    { id: 'w3', department_id: dept2?.id ?? 'dept-2', ticket_number: 'B-043', created_at: new Date(Date.now() - 120000).toISOString() },
    { id: 'w4', department_id: dept1?.id ?? 'dept-1', ticket_number: 'A-108', created_at: new Date(Date.now() - 60000).toISOString() },
    { id: 'w5', department_id: dept2?.id ?? 'dept-2', ticket_number: 'B-044', created_at: new Date(Date.now() - 30000).toISOString() },
  ];

  return { activeTickets, waitingTickets };
}

// ─── Full-page Live Screen Editor ────────────────────────────────────────

interface ScreenEditorProps {
  screen: DisplayScreen;
  departments: Department[];
  offices: Office[];
  organization?: { name: string; logo_url?: string | null };
  onClose: () => void;
  onSaved: (updated: DisplayScreen) => void;
}

function ScreenEditor({ screen, departments, offices, organization, onClose, onSaved }: ScreenEditorProps) {
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const s = screen.settings ?? {};

  // ─── Settings state ────────────────────────────────────────
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
  const [announcementVoice, setAnnouncementVoice] = useState<string>(s.announcement_voice ?? 'none');
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
        announcement_voice: announcementVoice,
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
        setSavedMsg('Saved!');
        setTimeout(() => setSavedMsg(null), 3000);
        onSaved({ ...screen, name, layout, settings });
      }
    });
  }

  function previewVoice(voiceId: string) {
    speakAnnouncement('A-105', 'Counter 1', voiceId);
  }

  // ─── Build live preview props ──────────────────────────────
  const { activeTickets, waitingTickets } = buildMockData(departments);

  const officeName = offices.find((o) => o.id === screen.office_id)?.name ?? 'Main Office';

  const previewScreenProps = {
    id: screen.id,
    name,
    layout,
    settings: {
      theme,
      bg_color: bgColor,
      accent_color: accentColor,
      text_size: textSize,
      show_clock: showClock,
      show_next_up: showNextUp,
      show_department_breakdown: showDeptBreakdown,
      show_estimated_wait: showEstimatedWait,
      max_tickets_shown: maxTicketsShown,
      announcement_sound: false, // mute in preview
      announcement_voice: 'none',
      announcement_duration: announcementDuration,
      auto_scroll_interval: autoScrollInterval,
      visible_department_ids: visibleDeptIds,
    },
  };

  const previewOffice = {
    id: screen.office_id,
    name: officeName,
    organization: organization ? { name: organization.name, logo_url: organization.logo_url } : undefined,
  };

  const previewDepartments = departments.map((d) => ({ id: d.id, name: d.name, code: d.code }));

  const inputClass =
    'w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-primary/30 focus:border-primary/50';

  return (
    <div className="fixed inset-0 z-50 flex bg-background">
      {/* ─── Left: Settings Panel ─────────────────────────────── */}
      <div className="w-[420px] shrink-0 overflow-y-auto border-r border-border bg-card">
        {/* Header */}
        <div className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-card px-5 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-xl p-2 hover:bg-muted transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h2 className="text-sm font-bold text-foreground">Live Editor</h2>
              <p className="text-xs text-muted-foreground">{screen.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {savedMsg && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {savedMsg}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Save className="h-3.5 w-3.5" />
              {isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        <div className="space-y-5 p-5">
          {errorMessage && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {errorMessage}
            </div>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Screen Name
            </label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>

          {/* Layout */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Layout
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { value: 'list', label: 'List' },
                { value: 'grid', label: 'Grid' },
                { value: 'department_split', label: 'Split' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setLayout(opt.value)}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
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

          {/* ── Appearance ──────────────────────────────────── */}
          <section className="rounded-xl border border-border">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-xs font-bold text-foreground">Appearance</h3>
            </div>
            <div className="space-y-3 px-4 py-4">
              {/* Theme */}
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => { setTheme('dark'); setBgColor('#0a1628'); setAccentColor('#3b82f6'); }}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                    theme === 'dark' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'
                  }`}
                >
                  <span className="h-3 w-3 rounded-full bg-[#0a1628] border border-gray-500" />
                  Dark
                </button>
                <button
                  onClick={() => { setTheme('light'); setBgColor('#f8fafc'); setAccentColor('#2563eb'); }}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                    theme === 'light' ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'
                  }`}
                >
                  <span className="h-3 w-3 rounded-full bg-[#f8fafc] border border-gray-300" />
                  Light
                </button>
              </div>

              {/* Colors */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Background</label>
                  <div className="flex items-center gap-1.5">
                    <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-border" />
                    <input type="text" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs font-mono outline-none" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Accent</label>
                  <div className="flex items-center gap-1.5">
                    <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-border" />
                    <input type="text" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs font-mono outline-none" />
                  </div>
                </div>
              </div>

              {/* Text size */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Text Size</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['sm', 'md', 'lg'] as const).map((sz) => (
                    <button
                      key={sz}
                      onClick={() => setTextSize(sz)}
                      className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                        textSize === sz ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'
                      }`}
                    >
                      {sz === 'sm' ? 'Small' : sz === 'md' ? 'Medium' : 'Large'}
                    </button>
                  ))}
                </div>
              </div>

              <ToggleRow label="Show Clock" checked={showClock} onChange={setShowClock} />
            </div>
          </section>

          {/* ── Content ────────────────────────────────────── */}
          <section className="rounded-xl border border-border">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-xs font-bold text-foreground">Content</h3>
            </div>
            <div className="space-y-1 px-4 py-3">
              <ToggleRow label="Next Up queue list" checked={showNextUp} onChange={setShowNextUp} />
              <ToggleRow label="Department breakdown" checked={showDeptBreakdown} onChange={setShowDeptBreakdown} />
              <ToggleRow label="Estimated wait times" checked={showEstimatedWait} onChange={setShowEstimatedWait} />
              <div className="flex items-center justify-between gap-3 py-2">
                <span className="text-xs font-medium text-foreground">Max tickets shown</span>
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={maxTicketsShown}
                  onChange={(e) => setMaxTicketsShown(Number(e.target.value))}
                  className="w-16 rounded-lg border border-input bg-background px-2 py-1.5 text-xs text-center outline-none"
                />
              </div>
            </div>
          </section>

          {/* ── Voice Announcement ─────────────────────────── */}
          <section className="rounded-xl border border-border">
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-primary" />
                <h3 className="text-xs font-bold text-foreground">Voice Announcement</h3>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Speaks &quot;Now serving [ticket], please proceed to [desk]&quot; when a number is called.
              </p>
            </div>
            <div className="space-y-2 px-4 py-4">
              {/* None option */}
              <button
                onClick={() => setAnnouncementVoice('none')}
                className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                  announcementVoice === 'none'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                    : 'border-border hover:bg-muted'
                }`}
              >
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">No voice</p>
                  <p className="text-xs text-muted-foreground">Chime only</p>
                </div>
              </button>

              {/* Voice presets */}
              {Object.entries(VOICE_PRESETS).map(([id, preset]) => (
                <div
                  key={id}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                    announcementVoice === id
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <button
                    onClick={() => setAnnouncementVoice(id)}
                    className="flex-1 text-left"
                  >
                    <p className="text-sm font-semibold text-foreground">{preset.label}</p>
                    <p className="text-xs text-muted-foreground">{preset.description}</p>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      previewVoice(id);
                    }}
                    className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
                  >
                    <Play className="h-3 w-3" />
                    Preview
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* ── Behavior ───────────────────────────────────── */}
          <section className="rounded-xl border border-border">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-xs font-bold text-foreground">Behavior</h3>
            </div>
            <div className="space-y-1 px-4 py-3">
              <ToggleRow label="Play chime sound" checked={announcementSound} onChange={setAnnouncementSound} />
              <div className="flex items-center justify-between gap-3 py-2">
                <span className="text-xs font-medium text-foreground">Announcement duration (s)</span>
                <input
                  type="number" min={3} max={30}
                  value={announcementDuration}
                  onChange={(e) => setAnnouncementDuration(Number(e.target.value))}
                  className="w-16 rounded-lg border border-input bg-background px-2 py-1.5 text-xs text-center outline-none"
                />
              </div>
              <div className="flex items-center justify-between gap-3 py-2">
                <span className="text-xs font-medium text-foreground">Auto-scroll interval (s)</span>
                <input
                  type="number" min={5} max={60}
                  value={autoScrollInterval}
                  onChange={(e) => setAutoScrollInterval(Number(e.target.value))}
                  className="w-16 rounded-lg border border-input bg-background px-2 py-1.5 text-xs text-center outline-none"
                />
              </div>
            </div>
          </section>

          {/* ── Department Filter ──────────────────────────── */}
          <section className="rounded-xl border border-border">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-xs font-bold text-foreground">Visible Departments</h3>
            </div>
            <div className="px-4 py-3 space-y-1">
              {departments.map((dept) => (
                <div key={dept.id} className="flex items-center justify-between gap-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">{dept.name}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{dept.code}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={visibleDeptIds.includes(dept.id)}
                    onChange={() => toggleDept(dept.id)}
                    className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary/50"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Open full screen link */}
          <a
            href={`/display/${screen.screen_token}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open full screen
          </a>
        </div>
      </div>

      {/* ─── Right: Live Preview ──────────────────────────────── */}
      <div className="flex-1 overflow-hidden bg-muted/30 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Live Preview
          </p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        </div>
        <div
          className="relative w-full overflow-hidden rounded-2xl border border-border bg-black shadow-2xl"
          style={{ height: 'calc(100vh - 110px)' }}
        >
          <div
            style={{
              transform: 'scale(0.55)',
              transformOrigin: 'top left',
              width: `${100 / 0.55}%`,
              height: `${100 / 0.55}%`,
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          >
            <DisplayBoard
              screen={previewScreenProps}
              office={previewOffice}
              departments={previewDepartments}
              initialActiveTickets={activeTickets}
              initialWaitingTickets={waitingTickets}
              calledTicketCountdownSeconds={60}
              sandboxMode
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Toggle Row helper ─────────────────────────────────────────────────

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
          checked ? 'bg-primary' : 'bg-muted-foreground/25'
        }`}
      >
        <span
          className={`ml-0.5 block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
