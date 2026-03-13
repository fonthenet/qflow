'use client';

import { closeQueueNotifications, unsubscribeFromPush } from '@/lib/push';

export async function stopTicketTracking(ticketId: string): Promise<boolean> {
  try {
    await closeQueueNotifications(ticketId);
    await unsubscribeFromPush();

    const response = await fetch('/api/tracking-stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('[Tracking] Failed to stop tracking:', response.status, body);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Tracking] Stop tracking failed:', error);
    return false;
  }
}
