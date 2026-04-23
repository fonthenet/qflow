/**
 * Tamara (AE/SA BNPL) — stub.
 * Country gate: AE, SA.
 * Tamara is a Buy Now Pay Later provider popular in Saudi Arabia and UAE.
 * TODO: Integrate Tamara Checkout API + webhook signature verification.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const tamaraProvider = makeStub({
  id: 'tamara',
  displayName: {
    en: 'Tamara (BNPL)',
    fr: 'Tamara (BNPL)',
    ar: 'تمارا',
  },
  supportedCountries: ['AE', 'SA', 'KW', 'QA'],
  supportedCurrencies: ['AED', 'SAR', 'KWD', 'QAR'],
  capabilities: {
    deposits: false,
    noShowFees: false,
    tipping: false,
    subscriptions: false,
    recurring: false,
    threeDSecure: false,
  },
});

registerProvider(tamaraProvider);
export default tamaraProvider;
