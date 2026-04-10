/**
 * Valid ticket status transitions (local copy for Electron main process).
 *
 * Keep in sync with packages/shared/src/constants/ticket-transitions.ts.
 *
 * Terminal states (served, cancelled, no_show) have no outgoing transitions.
 * "parked" is not a separate status — it uses the parked_at timestamp.
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
