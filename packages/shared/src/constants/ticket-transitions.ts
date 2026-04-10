import type { TicketStatus } from './ticket-statuses';

/**
 * Valid ticket status transitions.
 *
 * Terminal states (served, cancelled, no_show) have no outgoing transitions.
 * The `pending_approval` status is used by remote-join / kiosk flows when
 * the office requires approval before a ticket enters the queue.
 *
 * Note: "parked" is not a separate status — it is represented by a non-null
 * `parked_at` timestamp while the ticket remains in its current status.
 */
export const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  issued:            ['waiting', 'cancelled'],
  pending_approval:  ['waiting', 'cancelled'],
  waiting:           ['called', 'cancelled', 'no_show', 'transferred'],
  called:            ['serving', 'waiting', 'cancelled', 'no_show'],
  serving:           ['served', 'waiting', 'cancelled', 'no_show'],
  served:            [],
  cancelled:         [],
  no_show:           [],
  transferred:       ['waiting', 'cancelled'],
};

const TERMINAL_SET = new Set<string>(['served', 'cancelled', 'no_show']);

/**
 * Returns true if transitioning from `from` to `to` is allowed.
 */
export function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Returns true if the status is terminal (no further transitions possible).
 */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_SET.has(status);
}
