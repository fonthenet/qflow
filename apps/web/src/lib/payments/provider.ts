/**
 * Payment provider interface — the single abstraction all rails implement.
 *
 * Design rules:
 * - amounts are always in minor units (centimes for DZD, pence for GBP, etc.)
 * - currency follows org.currency — never hardcoded
 * - every provider must implement refund before going live
 * - idempotency keys are the caller's responsibility; providers must honour them
 */

// ── Capability descriptor ─────────────────────────────────────────────────────

export interface PaymentCapabilities {
  deposits: boolean;
  noShowFees: boolean;
  tipping: boolean;
  subscriptions: boolean;
  recurring: boolean;
  threeDSecure: boolean;
}

// ── Core params / results ─────────────────────────────────────────────────────

export interface CheckoutCustomer {
  /** Internal Qflo customer ID */
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
}

export interface CreateCheckoutParams {
  /** Amount in minor units (centimes, pence, fils, etc.) */
  amount: number;
  /** ISO-4217 currency code */
  currency: string;
  /** Human-readable description shown on the payment page */
  description?: string;
  /** Idempotency key — callers must supply; prevent double charges on retry */
  idempotencyKey: string;
  /** Where to redirect after hosted checkout (not required for embedded flows) */
  returnUrl?: string;
  customer?: CheckoutCustomer;
  /** Arbitrary key-value metadata stored on the payment object */
  metadata?: Record<string, string>;
  /** Specific flow type */
  flow?: 'deposit' | 'no_show_fee' | 'tip' | 'subscription' | 'one_time';
}

export interface CheckoutResult {
  /** Provider-side payment reference (charge id, payment intent id, …) */
  providerReference: string;
  /** Set when the provider uses a redirect-based hosted checkout */
  redirectUrl?: string;
  /** Set when the provider uses a client-side embedded flow (Stripe Elements) */
  clientSecret?: string;
  /** Set for QR-code-based payment flows (Fawry, SATIM, etc.) */
  qrCode?: string;
  /** Raw provider response — logged but never surfaced to the customer */
  raw?: unknown;
}

export interface WebhookEvent {
  /** Normalised event type, e.g. 'payment.succeeded', 'payment.failed', 'refund.succeeded' */
  type: string;
  /** Provider that fired this event ('stripe', 'cib', …) */
  provider: string;
  /** Provider-side event ID — used for idempotency dedup */
  providerEventId: string;
  /** Provider-side payment reference */
  reference: string;
  /** Amount in minor units */
  amount?: number;
  /** ISO-4217 currency */
  currency?: string;
  /** Metadata originally passed at checkout creation */
  metadata?: Record<string, string>;
  /** Raw provider payload — stored for audit; never returned to the client */
  raw: unknown;
}

export interface RefundParams {
  /** Provider-side payment reference to refund */
  providerReference: string;
  /** Amount in minor units; omit for full refund */
  amount?: number;
  reason?: string;
  idempotencyKey: string;
}

export interface RefundResult {
  providerRefundId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
  raw?: unknown;
}

// ── Provider interface ────────────────────────────────────────────────────────

export interface PaymentProvider {
  /** Matches the id stored in country_config.payment_providers */
  id: string;
  displayName: { en: string; fr: string; ar: string };
  supportedCountries: string[];
  supportedCurrencies: string[];
  capabilities: PaymentCapabilities;
  /**
   * True when createCheckout and refund are fully implemented.
   * False for stubs — UI may show "Coming soon".
   */
  isImplemented: boolean;

  /**
   * Initiate a payment.
   * Must honour idempotencyKey — retries with the same key must NOT create a
   * second charge.
   */
  createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult>;

  /**
   * Verify and decode an inbound webhook request.
   * Takes the raw body string (pre-read by the route) and the provider-specific
   * signature header value. Returns null when the signature is invalid or the
   * body is unparseable. Must never throw — catch internally and return null.
   *
   * The route is responsible for reading the body once and passing it here so
   * that the raw bytes are also available for audit storage.
   */
  verifyWebhook(rawBody: string, signature: string | null): Promise<WebhookEvent | null>;

  /**
   * Issue a refund.
   * This path must exist before a rail can be declared production-ready.
   */
  refund(params: RefundParams): Promise<RefundResult>;

  /**
   * Given a verified webhook event and an admin Supabase client, attempt to
   * resolve the Qflo organization_id from the provider's customer identifier
   * (e.g. Stripe's `customer` field on a PaymentIntent).
   *
   * Return the resolved organization UUID string, or null when the customer
   * cannot be resolved (platform-level event, missing customer, etc.).
   *
   * Default implementation (stubs) returns null.
   * The Stripe provider resolves via `organizations.stripe_customer_id`.
   *
   * This is intentionally async because it may need a DB lookup.
   */
  resolveCustomerOrg?(
    event: WebhookEvent,
    // Using `unknown` here so the provider.ts file does not import Supabase
    // types — callers cast as needed.
    adminClient: unknown
  ): Promise<string | null>;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class NotImplementedError extends Error {
  constructor(provider: string, method: string) {
    super(`Payment provider '${provider}' has not implemented '${method}' yet.`);
    this.name = 'NotImplementedError';
  }
}
