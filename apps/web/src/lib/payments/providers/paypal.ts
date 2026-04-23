/**
 * PayPal (FR/US) — stub.
 * DB seed uses 'paypal' for FR and US countries.
 * TODO: Integrate PayPal Orders API v2 + webhook HMAC-SHA256 verification.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const paypalProvider = makeStub({
  id: 'paypal',
  displayName: {
    en: 'PayPal',
    fr: 'PayPal',
    ar: 'باي بال',
  },
  supportedCountries: ['FR', 'US', 'DE', 'GB', 'IT', 'ES', 'AU', 'CA'],
  supportedCurrencies: ['EUR', 'USD', 'GBP', 'AUD', 'CAD'],
  capabilities: {
    deposits: true,
    noShowFees: false,
    tipping: true,
    subscriptions: true,
    recurring: true,
    threeDSecure: false,
  },
});

registerProvider(paypalProvider);
export default paypalProvider;
