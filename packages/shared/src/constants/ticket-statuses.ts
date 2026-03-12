export const TICKET_STATUSES = {
  ISSUED: 'issued',
  WAITING: 'waiting',
  CALLED: 'called',
  SERVING: 'serving',
  SERVED: 'served',
  NO_SHOW: 'no_show',
  CANCELLED: 'cancelled',
  TRANSFERRED: 'transferred',
} as const;

export type TicketStatus = (typeof TICKET_STATUSES)[keyof typeof TICKET_STATUSES];

export const ACTIVE_STATUSES: TicketStatus[] = [
  TICKET_STATUSES.ISSUED,
  TICKET_STATUSES.WAITING,
  TICKET_STATUSES.CALLED,
  TICKET_STATUSES.SERVING,
];

export const TERMINAL_STATUSES: TicketStatus[] = [
  TICKET_STATUSES.SERVED,
  TICKET_STATUSES.NO_SHOW,
  TICKET_STATUSES.CANCELLED,
];
