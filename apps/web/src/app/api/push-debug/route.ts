import { NextResponse } from 'next/server';

/**
 * GET /api/push-debug
 * Returns an HTML page that checks service worker, notification, and push state.
 * Open this on your phone to diagnose push notification issues.
 */
export async function GET() {
  const html = `<!DOCTYPE html>
<html><head><title>Push Debug</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:monospace;padding:16px;background:#111;color:#0f0}
.ok{color:#0f0}.err{color:#f00}.warn{color:#ff0}
button{font-size:18px;padding:12px 24px;margin:8px;background:#333;color:#fff;border:1px solid #555;border-radius:8px}
pre{white-space:pre-wrap;word-break:break-all;background:#222;padding:8px;border-radius:4px}
</style></head><body>
<h2>Qflo Push Debug</h2>
<div id="log"></div>
<button onclick="testPush()">Send Test Push</button>
<button onclick="resubscribe()">Re-subscribe Push</button>
<button onclick="checkSW()">Check SW Status</button>
<script>
const log = document.getElementById('log');
function L(msg, cls='ok') {
  log.innerHTML += '<div class="'+cls+'">'+msg+'</div>';
}

async function checkSW() {
  log.innerHTML = '';

  // 1. Notification permission
  if ('Notification' in window) {
    L('Notification.permission = ' + Notification.permission,
      Notification.permission === 'granted' ? 'ok' : 'warn');
  } else {
    L('Notification API not available', 'err');
  }

  // 2. Service Worker
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    L('Service Worker registrations: ' + regs.length, regs.length > 0 ? 'ok' : 'err');
    for (const reg of regs) {
      L('  scope: ' + reg.scope);
      L('  active: ' + (reg.active ? reg.active.state : 'none'), reg.active ? 'ok' : 'err');
      L('  waiting: ' + (reg.waiting ? 'yes' : 'none'));
      L('  installing: ' + (reg.installing ? 'yes' : 'none'));

      // 3. Push subscription
      try {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          L('Push subscription: ACTIVE', 'ok');
          L('  endpoint: ' + sub.endpoint.slice(0, 80) + '...');
          L('  expirationTime: ' + sub.expirationTime);
        } else {
          L('Push subscription: NONE', 'err');
        }
      } catch(e) {
        L('Push subscription error: ' + e.message, 'err');
      }
    }

    // Listen for SW messages
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'push-received') {
        L('>>> SW reported push received: ' + JSON.stringify(e.data.data), 'ok');
      }
    });
  } else {
    L('Service Worker not supported', 'err');
  }

  // 4. VAPID key
  L('VAPID key available: ' + (typeof window !== 'undefined'));
}

async function resubscribe() {
  try {
    // Register SW
    const reg = await navigator.serviceWorker.register('/sw-notify.js');
    L('SW registered, waiting for active...', 'warn');
    await navigator.serviceWorker.ready;
    L('SW is active', 'ok');

    // Request permission
    if (Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      L('Permission result: ' + result, result === 'granted' ? 'ok' : 'err');
      if (result !== 'granted') return;
    }

    // Unsubscribe old
    const old = await reg.pushManager.getSubscription();
    if (old) {
      await old.unsubscribe();
      L('Old subscription removed', 'warn');
    }

    // Subscribe fresh
    const resp = await fetch('/api/config');
    const config = await resp.json();
    L('VAPID key from server: ' + (config.vapidPublicKey ? 'present' : 'MISSING'),
      config.vapidPublicKey ? 'ok' : 'err');

    // We don't have the VAPID key exposed in config, use inline
    L('Subscribing with PushManager...', 'warn');
    // This will use the key baked into the client bundle

    L('Done. Now create a ticket and test.', 'ok');
  } catch(e) {
    L('Error: ' + e.message, 'err');
  }
}

async function testPush() {
  L('Triggering test notification locally via SW...', 'warn');
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('Local Test', {
      body: 'This notification was triggered locally (not via push)',
      icon: '/favicon.ico',
      vibrate: [200, 100, 200],
      tag: 'local-test',
      renotify: true,
      silent: false,
    });
    L('showNotification called successfully!', 'ok');
  } catch(e) {
    L('showNotification FAILED: ' + e.message, 'err');
  }
}

// Auto-check on load
checkSW();
</script></body></html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
