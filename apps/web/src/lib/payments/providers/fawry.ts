/**
 * Fawry (Egypt) — stub.
 * Country gate: EG only.
 * Fawry supports QR-code and reference-number based payments, widely used in Egypt.
 * TODO: Integrate Fawry Pay API + HMAC-SHA256 webhook signature.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const fawryProvider = makeStub({
  id: 'fawry',
  displayName: {
    en: 'Fawry (Egypt)',
    fr: 'Fawry (Égypte)',
    ar: 'فوري',
  },
  supportedCountries: ['EG'],
  supportedCurrencies: ['EGP'],
  capabilities: {
    deposits: true,
    noShowFees: true,
    tipping: false,
    subscriptions: false,
    recurring: false,
    threeDSecure: false,
  },
});

registerProvider(fawryProvider);
export default fawryProvider;
