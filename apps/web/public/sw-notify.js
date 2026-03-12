// QueueFlow Service Worker — handles Web Push notifications
self.addEventListener('install', (e) => {
  console.log('[SW] Installing...');
  e.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (e) => {
  console.log('[SW] Activating...');
  e.waitUntil(self.clients.claim());
});

// Handle incoming push notifications from server
self.addEventListener('push', (event) => {
  console.log('[SW] Push received!', event);

  let data = {};
  try {
    data = event.data ? event.data.json() : {};
    console.log('[SW] Push data:', JSON.stringify(data));
  } catch (err) {
    console.error('[SW] Failed to parse push data:', err);
    data = { title: 'QueueFlow', body: 'You have a notification' };
  }

  const title = data.title || 'QueueFlow';
  const options = {
    body: data.body || 'You have a notification',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: data.tag || 'queueflow-' + Date.now(),
    renotify: true,
    vibrate: [300, 150, 300, 150, 300, 150, 600],
    requireInteraction: true,
    silent: false,
    data: { url: data.url || '/' },
    actions: [{ action: 'open', title: 'Open' }],
  };

  // Post to any open clients so they know a push arrived
  self.clients.matchAll({ type: 'window' }).then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type: 'push-received', data });
    });
  });

  event.waitUntil(
    self.registration.showNotification(title, options).catch((err) => {
      console.error('[SW] showNotification failed:', err);
    })
  );
});

// Handle notification click — focus or open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.length > 0) {
        return clients[0].focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
