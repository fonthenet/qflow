/**
 * Mada (Saudi Arabia) — stub.
 * Country gate: SA only.
 * Mada is the national debit card network in Saudi Arabia, operates over Stripe.
 * TODO: Enable Mada via Stripe's Mada integration (no separate API — requires
 * Stripe account with SA enabled + mada payment method type).
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const madaProvider = makeStub({
  id: 'mada',
  displayName: {
    en: 'Mada (Saudi Arabia)',
    fr: 'Mada (Arabie saoudite)',
    ar: 'مدى',
  },
  supportedCountries: ['SA'],
  supportedCurrencies: ['SAR'],
  capabilities: {
    deposits: true,
    noShowFees: true,
    tipping: false,
    subscriptions: false,
    recurring: false,
    threeDSecure: true,
  },
});

registerProvider(madaProvider);
export default madaProvider;
