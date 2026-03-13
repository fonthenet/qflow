'use client';

import { closeQueueNotifications, unsubscribeFromPush } from '@/lib/push';

export interface StopTicketTrackingResult {
  leftQueue: boolean;
}

export async function stopTicketTracking(ticketId: string): Promise<StopTicketTrackingResult | null> {
  try {
    const response = await fetch('/api/tracking-stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('[Tracking] Failed to stop tracking:', response.status, body);
      return null;
    }

    const payload = (await response.json().catch(() => null)) as
      | { leftQueue?: boolean }
      | null;

    await closeQueueNotifications(ticketId);
    await unsubscribeFromPush();

    return {
      leftQueue: Boolean(payload?.leftQueue),
    };
  } catch (error) {
    console.error('[Tracking] Stop tracking failed:', error);
    return null;
  }
}
