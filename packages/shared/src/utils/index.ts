export const isElectron = () =>
  typeof window !== 'undefined' && !!(window as any).electronAPI;

export const isServer = () => typeof window === 'undefined';

export function formatTicketNumber(departmentCode: string, sequence: number): string {
  return `${departmentCode}-${String(sequence).padStart(3, '0')}`;
}

export function estimateWaitMinutes(
  positionInQueue: number,
  avgServiceTimeMinutes: number
): number {
  return Math.ceil(positionInQueue * avgServiceTimeMinutes);
}

export function formatWaitTime(minutes: number): string {
  if (minutes < 1) return 'Less than a minute';
  if (minutes === 1) return '1 minute';
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}min`;
}
