export type SandboxSurfaceKey =
  | 'overview'
  | 'booking'
  | 'kiosk'
  | 'desk'
  | 'queue'
  | 'display';

export const sandboxSurfaceMeta: Array<{
  key: SandboxSurfaceKey;
  label: string;
  description: string;
}> = [
  {
    key: 'overview',
    label: 'Overview',
    description: 'Open the full sandbox hub and cross-check the full experience.',
  },
  {
    key: 'booking',
    label: 'Booking',
    description: 'Test appointments or reservations without creating live records.',
  },
  {
    key: 'kiosk',
    label: 'Kiosk',
    description: 'Test the self-service flow and QR handoff.',
  },
  {
    key: 'desk',
    label: 'Desk',
    description: 'Test the business operator flow, including call, serve, transfer, and reset.',
  },
  {
    key: 'queue',
    label: 'Customer Queue',
    description: 'Test the customer queue-tracking journey and status changes.',
  },
  {
    key: 'display',
    label: 'Display',
    description: 'Test the public-facing queue screen or TV display.',
  },
];
