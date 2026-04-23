/**
 * useDeepLink — handles incoming qflo:// and https://qflo.com/join/<code> links.
 *
 * Supported deep link formats:
 *   qflo://join/<code>              — scan-to-join from WhatsApp / Messenger
 *   qflo://ticket/<token>           — direct ticket view
 *   https://qflo.com/join/<code>    — universal link (iOS) / App Link (Android)
 *   https://qflo.net/join/<code>    — fallback domain
 *
 * How it works:
 *   1. On mount, checks for a URL that launched the app (cold start).
 *   2. Subscribes to URL events for warm/hot starts.
 *   3. Parses the URL and calls the provided handlers.
 *
 * TODO(mobile-sprint-2): Wire handlers to Expo Router navigation so the user
 *   lands on the correct screen without an intermediate redirect.
 *
 * TODO(devops): Configure apple-app-site-association and assetlinks.json on
 *   the qflo.com domain to make universal/app links work in production.
 *   Without that file the OS falls back to opening Safari instead of the app.
 */

import { useEffect } from 'react';
import * as Linking from 'expo-linking';

export interface ParsedDeepLink {
  type: 'join' | 'ticket' | 'unknown';
  /** For type='join': the organisation join code */
  joinCode?: string;
  /** For type='ticket': the ticket token */
  ticketToken?: string;
  /** Raw URL for debugging */
  raw: string;
}

function parseDeepLink(url: string): ParsedDeepLink {
  // qflo://join/<code> or https://qflo.com/join/<code>
  const joinMatch = url.match(/\/join\/([a-zA-Z0-9_-]+)/);
  if (joinMatch) {
    return { type: 'join', joinCode: joinMatch[1], raw: url };
  }

  // qflo://ticket/<token> or https://qflo.com/q/<token>
  const ticketMatch = url.match(/\/(?:ticket|q)\/([a-zA-Z0-9_-]+)/);
  if (ticketMatch) {
    return { type: 'ticket', ticketToken: ticketMatch[1], raw: url };
  }

  return { type: 'unknown', raw: url };
}

interface UseDeepLinkOptions {
  onJoin?: (joinCode: string, raw: string) => void;
  onTicket?: (ticketToken: string, raw: string) => void;
  onUnknown?: (raw: string) => void;
}

/**
 * Mount this hook once in the root layout.
 *
 * @example
 * useDeepLink({
 *   onJoin: (code) => router.push(`/(customer)/scan?code=${code}`),
 *   onTicket: (token) => router.push(`/(customer)/queue/${token}`),
 * });
 */
export function useDeepLink({
  onJoin,
  onTicket,
  onUnknown,
}: UseDeepLinkOptions): void {
  useEffect(() => {
    function handle(url: string) {
      const parsed = parseDeepLink(url);
      switch (parsed.type) {
        case 'join':
          onJoin?.(parsed.joinCode!, url);
          break;
        case 'ticket':
          onTicket?.(parsed.ticketToken!, url);
          break;
        default:
          onUnknown?.(url);
      }
    }

    // Cold-start URL
    Linking.getInitialURL().then((url) => {
      if (url) handle(url);
    });

    // Warm / hot-start URL events
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handle(url);
    });

    return () => {
      subscription.remove();
    };
  // Handlers are intentionally excluded from deps — callers should memoize them
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
