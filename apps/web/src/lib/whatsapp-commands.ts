import 'server-only';

import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { handleInboundMessage, tNotification, notificationMessages } from '@/lib/messaging-commands';
export type { Channel, SendFn } from '@/lib/messaging-commands';
export { tNotification, notificationMessages };

/**
 * Handle an incoming WhatsApp message.
 * Thin wrapper around the channel-agnostic handler.
 *
 * @param phone  - The user's phone number (wa_id). May be empty for username adopters.
 * @param bsuid  - Business-Scoped User ID (present after March 31 2026).
 */
export async function handleWhatsAppMessage(
  phone: string,
  messageBody: string,
  profileName?: string,
  bsuid?: string,
  /** Optional location-share payload forwarded from the webhook. Used by
   *  the in-WhatsApp ordering flow's address step so customers can drop
   *  a pin instead of typing the street. */
  locationData?: { latitude: number; longitude: number; name?: string; address?: string },
): Promise<void> {
  // Use phone as primary identifier; fall back to BSUID for username adopters
  const identifier = phone || bsuid || '';
  if (!identifier) return;

  const sendFn = async ({ to, body }: { to: string; body: string }) => {
    const result = await sendWhatsAppMessage({ to, body });
    return { ok: result.ok };
  };

  await handleInboundMessage('whatsapp', identifier, messageBody, sendFn, profileName, bsuid, locationData);
}
