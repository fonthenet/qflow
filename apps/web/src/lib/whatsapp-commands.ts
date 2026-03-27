import 'server-only';

import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { handleInboundMessage, tNotification, notificationMessages } from '@/lib/messaging-commands';
export type { Channel, SendFn } from '@/lib/messaging-commands';
export { tNotification, notificationMessages };

/**
 * Handle an incoming WhatsApp message.
 * Thin wrapper around the channel-agnostic handler.
 */
export async function handleWhatsAppMessage(
  phone: string,
  messageBody: string,
  profileName?: string,
): Promise<void> {
  const sendFn = async ({ to, body }: { to: string; body: string }) => {
    const result = await sendWhatsAppMessage({ to, body });
    return { ok: result.ok };
  };

  await handleInboundMessage('whatsapp', phone, messageBody, sendFn, profileName);
}
