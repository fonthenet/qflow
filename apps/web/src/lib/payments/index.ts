/**
 * Payment providers bootstrap.
 *
 * Import this file (once, at the server boundary) to register all providers
 * as side-effects. All callers should import types and helpers from here,
 * never from individual provider files.
 *
 * Usage (server action / route handler):
 *   import { getProvider, getProvidersForCountry } from '@/lib/payments';
 *
 * Country advertised status:
 * - DZ is currently cash-only; electronic provider stubs (cib/edahabia/satim)
 *   remain registered here (for future activation) but are NOT advertised to
 *   DZ orgs — country_config.payment_providers is an empty array for DZ.
 *   Before initiating any checkout, always call isCashOnly(countryConfig)
 *   from lib/country.ts and gate the electronic payment path behind it.
 * - All other countries' providers are advertised as-configured in country_config.
 */

// ── Side-effect registrations ─────────────────────────────────────────────────
// Import order = preference fallback: implemented providers first.

// Stripe (full implementation — global fallback)
import './providers/stripe';

// Algeria
import './providers/cib';
import './providers/edahabia';
import './providers/satim';

// Morocco
import './providers/cmi';

// Tunisia
import './providers/clictopay';
import './providers/paymee';

// Egypt
import './providers/fawry';

// UAE
import './providers/network_international';
import './providers/tap';

// Saudi Arabia
import './providers/mada';
import './providers/stcpay';

// Gulf BNPL (AE + SA)
import './providers/tabby';
import './providers/tamara';

// India
import './providers/razorpay';
import './providers/paytm';

// EU
import './providers/sepa';

// US / FR
import './providers/paypal';
import './providers/square';

// West Africa mobile money
import './providers/wave';
import './providers/orange_money';

// East/West Africa mobile money
import './providers/mpesa';
import './providers/mtn_momo';

// Nigeria
import './providers/paystack';
import './providers/flutterwave';

// ── Re-exports ────────────────────────────────────────────────────────────────

export {
  getProvider,
  getProvidersForCountry,
  getDefaultProviderForCountry,
  getImplementedProvidersForCountry,
  getImplementedProviderForCountry,
  listRegisteredProviders,
  registerProvider,
} from './registry';

export type {
  PaymentProvider,
  PaymentCapabilities,
  CreateCheckoutParams,
  CheckoutResult,
  CheckoutCustomer,
  WebhookEvent,
  RefundParams,
  RefundResult,
} from './provider';

export { NotImplementedError } from './provider';
