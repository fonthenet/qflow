/**
 * Unified Visit types — shared by tickets (walk-in) and appointments (future booking).
 * Keep this file the single source of truth for status enums, terminal/upcoming sets,
 * and the status → theme-color mapping. Screens and components should import from here
 * rather than re-declaring their own copies.
 */
import type { ThemeColors } from './theme';

export type VisitKind = 'ticket' | 'appointment';

export type VisitStatus =
  // ticket statuses
  | 'waiting'
  | 'called'
  | 'serving'
  | 'served'
  | 'cancelled'
  | 'no_show'
  // appointment statuses
  | 'pending'
  | 'confirmed'
  | 'checked_in'
  | 'completed';

/** Statuses where the visit is done — nothing more for the customer to do. */
export const TERMINAL: VisitStatus[] = [
  'served',
  'cancelled',
  'no_show',
  'completed',
];

/** Appointment statuses before staff check-in. */
export const UPCOMING: VisitStatus[] = ['pending', 'confirmed'];

/** Active statuses where the customer is "in the flow". */
export const ACTIVE_TICKET: VisitStatus[] = ['waiting', 'called', 'serving'];

export function isTerminal(status?: string | null): boolean {
  return !!status && (TERMINAL as string[]).includes(status);
}

export function isUpcoming(status?: string | null): boolean {
  return !!status && (UPCOMING as string[]).includes(status);
}

export function isActiveTicket(status?: string | null): boolean {
  return !!status && (ACTIVE_TICKET as string[]).includes(status);
}

/** Theme-aware color pair for a status pill/badge. */
export function visitStatusColors(
  status: string | null | undefined,
  colors: ThemeColors,
): { fg: string; bg: string } {
  switch (status) {
    case 'called':
      return { fg: colors.called, bg: colors.calledBg };
    case 'serving':
    case 'checked_in':
      return { fg: colors.serving, bg: colors.servingBg };
    case 'waiting':
    case 'pending':
      return { fg: colors.waiting, bg: colors.waitingBg };
    case 'confirmed':
      return { fg: colors.primary, bg: colors.infoLight };
    case 'served':
    case 'completed':
      return { fg: colors.success, bg: colors.successLight };
    case 'cancelled':
    case 'no_show':
      return { fg: colors.error, bg: colors.errorLight };
    default:
      return { fg: colors.textSecondary, bg: colors.surfaceSecondary };
  }
}
