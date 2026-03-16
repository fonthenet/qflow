export const TICKET_EVENT_TYPES = {
  JOINED: 'joined',
  CHECKED_IN: 'checked_in',
  CALLED: 'called',
  RECALLED: 'recalled',
  SERVING_STARTED: 'serving_started',
  SERVED: 'served',
  NO_SHOW: 'no_show',
  CANCELLED: 'cancelled',
  TRANSFERRED: 'transferred',
  BUZZED: 'buzzed',
  FEEDBACK_SUBMITTED: 'feedback_submitted',
} as const;

export type TicketEventType = (typeof TICKET_EVENT_TYPES)[keyof typeof TICKET_EVENT_TYPES];
