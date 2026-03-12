interface PriorityBadgeProps {
  name: string;
  icon?: string | null;
  color?: string | null;
}

export function PriorityBadge({ name, icon, color }: PriorityBadgeProps) {
  const bgColor = color ?? '#6b7280';

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: bgColor }}
    >
      {icon && <span className="text-sm leading-none">{icon}</span>}
      <span>{name}</span>
    </span>
  );
}
