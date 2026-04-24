/**
 * Payment module — re-exports billing/stripe for the webhook route.
 *
 * This module exposes the Stripe billing integration used for Qflo's own
 * SaaS subscription billing. Customer-facing payment support is limited to
 * the `accepts_cash` flag on the organization.
 */

export {
  getStripeClient,
  verifyStripeWebhook,
  resolveOrgFromStripeCustomer,
  normaliseStripeEvent,
} from '../billing/stripe';

export type { BillingWebhookEvent } from '../billing/stripe';
