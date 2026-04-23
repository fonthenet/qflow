/**
 * Tabby (AE/SA BNPL) — stub.
 * Country gate: AE, SA.
 * Tabby is a Buy Now Pay Later provider operating across the Gulf.
 * TODO: Integrate Tabby Checkout API + webhook HMAC verification.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const tabbyProvider = makeStub({
  id: 'tabby',
  displayName: {
    en: 'Tabby (BNPL)',
    fr: 'Tabby (BNPL)',
    ar: 'تابي',
  },
  supportedCountries: ['AE', 'SA', 'KW', 'QA', 'BH'],
  supportedCurrencies: ['AED', 'SAR', 'KWD', 'QAR', 'BHD'],
  capabilities: {
    deposits: false,
    noShowFees: false,
    tipping: false,
    subscriptions: false,
    recurring: false,
    threeDSecure: false,
  },
});

registerProvider(tabbyProvider);
export default tabbyProvider;
