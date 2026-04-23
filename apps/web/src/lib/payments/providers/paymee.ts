/**
 * Paymee (Tunisia) — stub.
 * Country gate: TN only.
 * This is the ID stored in the DB seed (country_config.payment_providers for TN).
 * TODO: Integrate Paymee hosted checkout + webhook verification.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const paymeeProvider = makeStub({
  id: 'paymee',
  displayName: {
    en: 'Paymee (Tunisia)',
    fr: 'Paymee (Tunisie)',
    ar: 'بايمي',
  },
  supportedCountries: ['TN'],
  supportedCurrencies: ['TND'],
  capabilities: {
    deposits: true,
    noShowFees: true,
    tipping: false,
    subscriptions: false,
    recurring: false,
    threeDSecure: true,
  },
});

registerProvider(paymeeProvider);
export default paymeeProvider;
