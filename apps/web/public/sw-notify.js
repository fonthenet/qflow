// QueueFlow Service Worker — Premium Live Notification Engine
// Handles typed push notifications: position updates, call alerts, recalls, status transitions
// Uses tag-based replacement for silent live updates (Android "ongoing notification" feel)

self.addEventListener('install', (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// ─── Notification Rendering by Type ──────────────────────────────────────────

function buildNotification(data) {
  const type = data.type || 'called';
  const ticketId = data.ticketId || '';
  const ticketNumber = data.ticketNumber || '';
  const position = data.position;
  const estimatedWait = data.estimatedWait;
  const nowServing = data.nowServing;
  const deskName = data.deskName || 'your desk';
  const url = data.url || '/';

  switch (type) {
    // ── Silent position update (replaces in-place, no sound) ──
    case 'position_update': {
      const bodyParts = [];
      if (estimatedWait) bodyParts.push(`~${estimatedWait} min wait`);
      if (nowServing) bodyParts.push(`Now serving: ${nowServing}`);
      if (!bodyParts.length) bodyParts.push('Waiting for your turn');

      return {
        title: position ? `QueueFlow · #${position} in line` : 'QueueFlow · In queue',
        options: {
          body: bodyParts.join(' · '),
          icon: '/icon-192x192.png',
          badge: '/badge-96x96.png',
          tag: `qf-queue-${ticketId}`,
          renotify: false,
          silent: true,
          requireInteraction: false,
          data: { url, ticketId, type },
          actions: [
            { action: 'view', title: 'View Queue' },
          ],
        },
      };
    }

    // ── YOUR TURN — loud alert ──
    case 'called': {
      return {
        title: "🔔 YOUR TURN!",
        options: {
          body: `Ticket ${ticketNumber} — Go to ${deskName}`,
          icon: '/icon-192x192.png',
          badge: '/badge-96x96.png',
          tag: `qf-turn-${ticketId}`,
          renotify: true,
          requireInteraction: true,
          vibrate: [300, 150, 300, 150, 300, 150, 600],
          data: { url, ticketId, type },
          actions: [
            { action: 'open', title: 'Open' },
            { action: 'onmyway', title: 'On my way' },
          ],
        },
      };
    }

    // ── RECALL — urgent re-alert ──
    case 'recall': {
      const recallCount = data.recallCount || 1;
      return {
        title: "⚠️ REMINDER — YOUR TURN!",
        options: {
          body: `Ticket ${ticketNumber} — Go to ${deskName} NOW${recallCount > 1 ? ` (recall #${recallCount})` : ''}`,
          icon: '/icon-192x192.png',
          badge: '/badge-96x96.png',
          tag: `qf-turn-${ticketId}`,
          renotify: true,
          requireInteraction: true,
          vibrate: [500, 200, 500, 200, 500],
          data: { url, ticketId, type },
          actions: [
            { action: 'open', title: 'Open' },
            { action: 'onmyway', title: 'On my way' },
          ],
        },
      };
    }

    // ── Being served (quiet status update) ──
    case 'serving': {
      return {
        title: 'Being Served',
        options: {
          body: `Ticket ${ticketNumber} at ${deskName}`,
          icon: '/icon-192x192.png',
          badge: '/badge-96x96.png',
          tag: `qf-status-${ticketId}`,
          renotify: false,
          silent: true,
          requireInteraction: false,
          data: { url, ticketId, type },
        },
      };
    }

    // ── Visit complete ──
    case 'served': {
      return {
        title: 'Visit Complete ✓',
        options: {
          body: 'Thank you! Tap to leave feedback.',
          icon: '/icon-192x192.png',
          badge: '/badge-96x96.png',
          tag: `qf-done-${ticketId}`,
          renotify: false,
          silent: true,
          requireInteraction: false,
          data: { url, ticketId, type },
        },
      };
    }

    // ── BUZZ — maximum urgency, long aggressive vibration ──
    case 'buzz': {
      return {
        title: '📳 BUZZ!',
        options: {
          body: data.body || `Ticket ${ticketNumber} — Attention needed!`,
          icon: '/icon-192x192.png',
          badge: '/badge-96x96.png',
          tag: data.tag || `qf-buzz-${ticketId}-${Date.now()}`,
          renotify: true,
          requireInteraction: true,
          vibrate: [800, 200, 800, 200, 800, 200, 800, 200, 800],
          data: { url, ticketId, type },
          actions: [
            { action: 'open', title: 'Open' },
            { action: 'onmyway', title: 'On my way' },
          ],
        },
      };
    }

    // ── No show ──
    case 'no_show': {
      return {
        title: 'Missed Your Turn',
        options: {
          body: `Ticket ${ticketNumber} was marked as no-show.`,
          icon: '/icon-192x192.png',
          badge: '/badge-96x96.png',
          tag: `qf-done-${ticketId}`,
          renotify: false,
          silent: true,
          requireInteraction: false,
          data: { url, ticketId, type },
        },
      };
    }

    // ── Stop tracking — no visible notification, handled in push event ──
    case 'stop_tracking': {
      return {
        title: '',
        options: {
          body: '',
          tag: `qf-stop-${ticketId}`,
          silent: true,
          data: { url, ticketId, type },
        },
      };
    }

    // ── Legacy fallback (backward compatible with old payloads) ──
    default: {
      return {
        title: data.title || 'QueueFlow',
        options: {
          body: data.body || 'You have a notification',
          icon: '/icon-192x192.png',
          badge: '/badge-96x96.png',
          tag: data.tag || `queueflow-${Date.now()}`,
          renotify: true,
          vibrate: [300, 150, 300, 150, 300, 150, 600],
          requireInteraction: true,
          data: { url: data.url || '/', ticketId, type: 'called' },
        },
      };
    }
  }
}

// ─── Close existing notifications for a ticket ──────────────────────────────

async function closeTicketNotifications(ticketId) {
  if (!ticketId) return;
  const notifications = await self.registration.getNotifications();
  for (const n of notifications) {
    if (n.data?.ticketId === ticketId) {
      n.close();
    }
  }
}

// ─── Push Event Handler ─────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const type = data.type || '';
  const ticketId = data.ticketId || '';

  event.waitUntil(
    (async () => {
      // For terminal states, close all existing notifications first
      if (type === 'served' || type === 'no_show') {
        await closeTicketNotifications(ticketId);
      }

      if (type === 'stop_tracking') {
        await closeTicketNotifications(ticketId);
        return;
      }

      // For "serving", close the "called" notification
      if (type === 'serving') {
        const notifications = await self.registration.getNotifications();
        for (const n of notifications) {
          if (n.data?.ticketId === ticketId && (n.tag?.includes('qf-turn-') || n.tag?.includes('qf-queue-'))) {
            n.close();
          }
        }
      }

      // For "called", close any position update notification
      if (type === 'called' || type === 'recall') {
        const notifications = await self.registration.getNotifications();
        for (const n of notifications) {
          if (n.data?.ticketId === ticketId && n.tag?.includes('qf-queue-')) {
            n.close();
          }
        }
      }

      const { title, options } = buildNotification(data);
      await self.registration.showNotification(title, options);

      // For buzz: post message to all open clients so they trigger
      // navigator.vibrate() directly (more reliable than notification vibrate property)
      if (type === 'buzz') {
        const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of allClients) {
          client.postMessage({ type: 'buzz', ticketId });
        }
      }
    })()
  );
});

// ─── Notification Click Handler ─────────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  const action = event.action;
  const notification = event.notification;
  notification.close();

  // "On my way" / dismiss — just close the notification
  if (action === 'onmyway' || action === 'dismiss') {
    return;
  }

  // "Open" / "View Queue" / default tap — focus or open the queue page
  const url = notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Try to focus an existing window on the queue page
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      // Focus any existing window
      if (clients.length > 0 && 'focus' in clients[0]) {
        clients[0].navigate(url);
        return clients[0].focus();
      }
      // Open new window
      return self.clients.openWindow(url);
    })
  );
});
