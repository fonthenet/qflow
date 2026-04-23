import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Idempotency store for generic channel webhooks.
 * Uses the `channel_webhook_events` table with UNIQUE(channel, message_id).
 *
 * Returns:
 *   'duplicate' — already seen, caller should return 200 immediately.
 *   'inserted'  — first delivery, caller should process.
 *   'error'     — insert failed for a non-dedup reason; caller may continue
 *                 (dedup is best-effort — better to process a potential dup
 *                  than to silently drop a real message).
 */
export type DedupResult = 'duplicate' | 'inserted' | 'error';

export async function dedupChannelEvent(
  channel: string,
  messageId: string,
  rawPayload: unknown,
): Promise<DedupResult> {
  const supabase = createAdminClient() as any;

  const { error } = await supabase
    .from('channel_webhook_events')
    .insert({
      channel,
      message_id: messageId,
      raw_payload: rawPayload ?? {},
      status: 'pending',
    });

  if (!error) return 'inserted';

  // Postgres unique violation: 23505
  if (
    error.code === '23505' ||
    (typeof error.message === 'string' && error.message.includes('unique'))
  ) {
    return 'duplicate';
  }

  console.error(`[dedup:${channel}] Non-dedup insert error:`, error);
  return 'error';
}

export async function markChannelEventProcessed(
  channel: string,
  messageId: string,
): Promise<void> {
  const supabase = createAdminClient() as any;
  await supabase
    .from('channel_webhook_events')
    .update({ status: 'processed', processed_at: new Date().toISOString() })
    .eq('channel', channel)
    .eq('message_id', messageId)
    .eq('status', 'pending');
}
