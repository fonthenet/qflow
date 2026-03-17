'use client';

import { useState, useTransition } from 'react';
import { Trash2, Star } from 'lucide-react';
import {
  createPriorityCategory,
  updatePriorityCategory,
  deletePriorityCategory,
} from '@/lib/actions/admin-actions';

type PriorityCategory = {
  id: string;
  organization_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  weight: number | null;
  is_active: boolean | null;
  created_at: string | null;
};

const PRESET_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#6b7280', // gray
  '#14b8a6', // teal
  '#f59e0b', // amber
];

const PRESET_ICONS = [
  '🔴', '🟠', '🟡', '🟢', '🔵', '🟣',
  '⭐', '🔥', '💎', '👑', '🎯', '⚡',
  '🏥', '👶', '♿', '🧓', '🤰', '🎖️',
];

export function PrioritiesClient({
  priorities,
}: {
  priorities: PriorityCategory[];
}) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PriorityCategory | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState('#ef4444');
  const [selectedIcon, setSelectedIcon] = useState('⭐');
  const [previewName, setPreviewName] = useState('');

  function openCreate() {
    setEditing(null);
    setError(null);
    setSelectedColor('#ef4444');
    setSelectedIcon('⭐');
    setPreviewName('');
    setShowModal(true);
  }

  function openEdit(category: PriorityCategory) {
    setEditing(category);
    setError(null);
    setSelectedColor(category.color ?? '#6b7280');
    setSelectedIcon(category.icon ?? '⭐');
    setPreviewName(category.name);
    setShowModal(true);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = editing
        ? await updatePriorityCategory(editing.id, formData)
        : await createPriorityCategory(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setShowModal(false);
        setEditing(null);
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this priority category?')) return;
    startTransition(async () => {
      const result = await deletePriorityCategory(id);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Priority Categories
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage priority levels for queue tickets. Higher weight = served
            sooner.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Add Priority
        </button>
      </div>

      {error && !showModal && (
        <div className="mb-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Preview
              </th>
              <th className="px-5 py-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Name
              </th>
              <th className="px-5 py-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Weight
              </th>
              <th className="px-5 py-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Color
              </th>
              <th className="px-5 py-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </th>
              <th className="px-5 py-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {priorities.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-6 py-16 text-center"
                >
                  <div className="flex flex-col items-center">
                    <Star className="h-10 w-10 text-muted-foreground/40 mb-3" />
                    <p className="text-sm font-semibold text-foreground">No priority categories</p>
                    <p className="text-sm text-muted-foreground mt-1">Create one to get started</p>
                  </div>
                </td>
              </tr>
            )}
            {priorities.map((cat) => (
              <tr
                key={cat.id}
                className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
              >
                <td className="px-5 py-4">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white"
                    style={{ backgroundColor: cat.color ?? '#6b7280' }}
                  >
                    {cat.icon && <span>{cat.icon}</span>}
                    {cat.name}
                  </span>
                </td>
                <td className="px-5 py-4 font-medium text-foreground">
                  {cat.name}
                </td>
                <td className="px-5 py-4 text-foreground font-mono">
                  {cat.weight}
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-4 w-4 rounded-full border border-border"
                      style={{ backgroundColor: cat.color ?? '#6b7280' }}
                    />
                    <span className="text-muted-foreground text-xs font-mono">
                      {cat.color}
                    </span>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      cat.is_active
                        ? 'bg-success/10 text-success'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {cat.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-5 py-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => openEdit(cat)}
                      className="rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(cat.id)}
                      disabled={isPending}
                      className="rounded-xl bg-destructive/10 p-2 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowModal(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-base font-semibold text-foreground">
                {editing ? 'Edit Priority Category' : 'Create Priority Category'}
              </h2>
            </div>

            <div className="p-6">
            {error && (
              <div className="mb-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-bold text-destructive">
                {error}
              </div>
            )}

            {/* Live Preview */}
            <div className="mb-4 rounded-xl border border-border bg-muted/50 p-4 text-center">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Badge Preview
              </p>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold text-white"
                style={{ backgroundColor: selectedColor }}
              >
                {selectedIcon && <span>{selectedIcon}</span>}
                {previewName || 'Priority Name'}
              </span>
            </div>

            <form action={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Name <span className="text-destructive">*</span>
                </label>
                <input
                  name="name"
                  required
                  defaultValue={editing?.name ?? ''}
                  onChange={(e) => setPreviewName(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                  placeholder="e.g., VIP, Elderly, Disabled"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Icon
                </label>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {PRESET_ICONS.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => setSelectedIcon(icon)}
                      className={`flex h-8 w-8 items-center justify-center rounded-xl border text-base transition-colors ${
                        selectedIcon === icon
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
                <input
                  name="icon"
                  value={selectedIcon}
                  onChange={(e) => setSelectedIcon(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Emoji icon"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Color
                </label>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setSelectedColor(color)}
                      className={`h-7 w-7 rounded-full border-2 transition-all ${
                        selectedColor === color
                          ? 'border-foreground scale-110'
                          : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <input
                  name="color"
                  type="text"
                  value={selectedColor}
                  onChange={(e) => setSelectedColor(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring font-mono"
                  placeholder="#ef4444"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Weight <span className="text-destructive">*</span>
                </label>
                <input
                  name="weight"
                  type="number"
                  required
                  min={1}
                  max={100}
                  defaultValue={editing?.weight ?? 10}
                  className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Higher weight = higher priority. Normal tickets have weight 0.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="is_active"
                  value="true"
                  defaultChecked={editing?.is_active ?? true}
                  className="h-4 w-4 rounded border-input"
                />
                <label className="text-sm font-semibold text-foreground">
                  Active
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isPending ? 'Saving...' : editing ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
