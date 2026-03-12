/**
 * Web Push subscription utility.
 * Subscribes the browser to push notifications and saves the subscription server-side.
 * Requires: notification permission granted, service worker registered.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Subscribe to Web Push and save the subscription for a ticket.
 * Call this after notification permission is granted.
 */
export async function subscribeToPush(ticketId: string): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY) {
    console.warn('VAPID public key not configured');
    return false;
  }

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    console.log('[Push] Service worker ready');

    // Always unsubscribe old and create fresh — expired subscriptions return 410 from FCM
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await existing.unsubscribe().catch(() => {});
      console.log('[Push] Unsubscribed old subscription');
    }

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as ArrayBuffer,
    });
    console.log('[Push] Fresh subscription created');

    // Save to server
    const res = await fetch('/api/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketId,
        subscription: subscription.toJSON(),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('[Push] Server save failed:', res.status, body);
      return false;
    }

    console.log('[Push] Subscription saved successfully');
    return true;
  } catch (err) {
    console.error('[Push] Subscription failed:', err);
    return false;
  }
}
