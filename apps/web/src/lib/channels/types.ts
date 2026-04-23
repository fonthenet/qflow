import 'server-only';

/**
 * Channel adapter interface — every messaging channel implements this.
 * Booking / queue logic is channel-agnostic and calls only these methods.
 */
export interface ChannelAdapter {
  /** Unique identifier for this channel (used as registry key). */
  readonly channel: string;

  /** Primary locale for this channel (BCP-47 tag). */
  readonly defaultLocale: string;

  /**
   * Send a plain-text message to a recipient.
   * @param to       Channel-native recipient identifier (phone, user ID, etc.)
   * @param content  Plain-text body
   * @param locale   BCP-47 locale for message language
   * @param orgId    Organization ID — required for per-tenant credential resolution
   */
  sendMessage(
    to: string,
    content: string,
    locale: string,
    orgId?: string,
  ): Promise<ChannelSendResult>;

  /**
   * Verify a webhook delivery's authenticity.
   * Throws or returns false if signature is invalid.
   */
  verifyWebhook(
    rawBody: string,
    signature: string,
    headers: Record<string, string>,
  ): Promise<boolean>;

  /**
   * Parse a raw inbound webhook body into a normalised message.
   * Returns null for non-message payloads (status updates, read receipts, etc.)
   */
  parseIncoming(rawBody: string): ChannelIncomingMessage | null;

  /**
   * Return a localised greeting string for deeplinks / QR codes.
   */
  getGreeting(locale: string): string;
}

export interface ChannelSendResult {
  ok: boolean;
  channel: string;
  to?: string;
  messageId?: string;
  error?: string;
}

export interface ChannelIncomingMessage {
  /** Dedup key — stable, unique per message */
  messageId: string;
  /** Channel-native sender identifier */
  from: string;
  /** Plain text body (empty string for non-text message types) */
  text: string;
  /** Display name if provided */
  senderName?: string;
  /** Original parsed payload for audit logging */
  rawPayload: unknown;
}
