'use client';

import { Mail, Phone, User, FileText, Hash, Calendar, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';

interface CustomerDataCardProps {
  data: Record<string, unknown> | null | undefined;
  className?: string;
}

const fieldIconMap: Record<string, ReactNode> = {
  phone: <Phone className="h-4 w-4" />,
  telephone: <Phone className="h-4 w-4" />,
  mobile: <Phone className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  mail: <Mail className="h-4 w-4" />,
  name: <User className="h-4 w-4" />,
  full_name: <User className="h-4 w-4" />,
  first_name: <User className="h-4 w-4" />,
  last_name: <User className="h-4 w-4" />,
  id_number: <Hash className="h-4 w-4" />,
  reference: <Hash className="h-4 w-4" />,
  date: <Calendar className="h-4 w-4" />,
  date_of_birth: <Calendar className="h-4 w-4" />,
  dob: <Calendar className="h-4 w-4" />,
  address: <MapPin className="h-4 w-4" />,
  city: <MapPin className="h-4 w-4" />,
};

function getFieldIcon(fieldName: string): ReactNode {
  const normalizedName = fieldName.toLowerCase().replace(/[\s-]/g, '_');
  return fieldIconMap[normalizedName] ?? <FileText className="h-4 w-4" />;
}

function formatLabel(fieldName: string): string {
  return fieldName
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '--';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

export function CustomerDataCard({ data, className = '' }: CustomerDataCardProps) {
  if (!data || Object.keys(data).length === 0) {
    return (
      <div className={`rounded-xl border border-border bg-card p-4 ${className}`}>
        <p className="text-sm text-muted-foreground text-center py-2">
          No customer data provided
        </p>
      </div>
    );
  }

  const entries = Object.entries(data).filter(
    ([, value]) => value !== null && value !== undefined
  );

  return (
    <div className={`rounded-xl border border-border bg-card ${className}`}>
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <User className="h-4 w-4 text-primary" />
          Customer Information
        </h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-0">
        {entries.map(([key, value], index) => (
          <div
            key={key}
            className={`flex items-start gap-3 px-4 py-3 ${
              index < entries.length - (entries.length % 2 === 0 ? 2 : 1)
                ? 'border-b border-border'
                : ''
            }`}
          >
            <span className="mt-0.5 text-muted-foreground flex-shrink-0">
              {getFieldIcon(key)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {formatLabel(key)}
              </p>
              <p className="text-sm font-medium text-foreground mt-0.5 break-words">
                {formatValue(value)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
