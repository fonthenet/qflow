export type PriorityAlertEvent = 'called' | 'recall' | 'buzz';

export interface PriorityAlertConfig {
  enabled: boolean;
  providerReady: boolean;
  onCall: boolean;
  onRecall: boolean;
  onBuzz: boolean;
  phoneLabel: string;
}

const PHONE_KEYS = ['phone', 'mobile', 'telephone', 'cell', 'cell_phone', 'mobile_number', 'customer_phone'] as const;

export function getPriorityAlertConfig(
  settings: Record<string, any> | null | undefined,
  providerReady = false
): PriorityAlertConfig {
  const source = settings ?? {};

  return {
    enabled: source.priority_alerts_sms_enabled === true,
    providerReady,
    onCall: source.priority_alerts_sms_on_call ?? true,
    onRecall: source.priority_alerts_sms_on_recall ?? true,
    onBuzz: source.priority_alerts_sms_on_buzz ?? true,
    phoneLabel: typeof source.priority_alerts_phone_label === 'string' &&
      source.priority_alerts_phone_label.trim().length > 0
      ? source.priority_alerts_phone_label.trim()
      : 'Mobile number',
  };
}

export function isPriorityAlertEventEnabled(
  config: PriorityAlertConfig | null | undefined,
  event: PriorityAlertEvent
): boolean {
  if (!config?.enabled) return false;

  switch (event) {
    case 'called':
      return config.onCall;
    case 'recall':
      return config.onRecall;
    case 'buzz':
      return config.onBuzz;
    default:
      return false;
  }
}

export function getEnabledPriorityAlertEvents(
  config: PriorityAlertConfig | null | undefined
): PriorityAlertEvent[] {
  if (!config?.enabled) return [];

  return (['called', 'recall', 'buzz'] as PriorityAlertEvent[]).filter((event) =>
    isPriorityAlertEventEnabled(config, event)
  );
}

export function formatPriorityAlertEvents(
  events: PriorityAlertEvent[]
): string {
  if (events.length === 0) return '';
  if (events.length === 1) return labelForEvent(events[0]);
  if (events.length === 2) return `${labelForEvent(events[0])} and ${labelForEvent(events[1])}`;

  return `${labelForEvent(events[0])}, ${labelForEvent(events[1])}, and ${labelForEvent(events[2])}`;
}

export function labelForEvent(event: PriorityAlertEvent): string {
  switch (event) {
    case 'called':
      return 'call';
    case 'recall':
      return 'recall';
    case 'buzz':
      return 'buzz';
    default:
      return event;
  }
}

export function normalizePhoneNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const stripped = trimmed.replace(/[^\d+]/g, '');
  if (!stripped) return null;

  if (stripped.startsWith('+')) {
    const digits = stripped.slice(1).replace(/\D/g, '');
    return digits.length >= 8 ? `+${digits}` : null;
  }

  const digits = stripped.replace(/\D/g, '');

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  return digits.length >= 8 ? `+${digits}` : null;
}

export function extractTicketPhone(customerData: unknown): string | null {
  if (!customerData || typeof customerData !== 'object' || Array.isArray(customerData)) {
    return null;
  }

  for (const key of PHONE_KEYS) {
    const candidate = (customerData as Record<string, unknown>)[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}
