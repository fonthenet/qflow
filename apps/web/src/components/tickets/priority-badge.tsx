interface PriorityBadgeProps {
  priorityCategory?: {
    name: string;
    icon: string | null;
    color: string | null;
  } | null;
  size?: 'sm' | 'md';
  className?: string;
}

export function PriorityBadge({
  priorityCategory,
  size = 'sm',
  className = '',
}: PriorityBadgeProps) {
  if (!priorityCategory) {
    return null;
  }

  const sizeClasses =
    size === 'sm'
      ? 'px-2 py-0.5 text-[10px] gap-1'
      : 'px-3 py-1 text-xs gap-1.5';

  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold text-white leading-tight ${sizeClasses} ${className}`}
      style={{ backgroundColor: priorityCategory.color ?? '#6b7280' }}
    >
      {priorityCategory.icon && <span>{priorityCategory.icon}</span>}
      {priorityCategory.name}
    </span>
  );
}
