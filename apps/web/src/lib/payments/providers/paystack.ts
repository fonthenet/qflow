/**
 * Paystack (Nigeria) — stub.
 * DB seed uses 'paystack' for NG.
 * TODO: Integrate Paystack Transactions API + HMAC-SHA512 webhook verification.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const paystackProvider = makeStub({
  id: 'paystack',
  displayName: {
    en: 'Paystack (Nigeria)',
    fr: 'Paystack (Nigéria)',
    ar: 'باي ستاك',
  },
  supportedCountries: ['NG', 'GH', 'ZA', 'KE'],
  supportedCurrencies: ['NGN', 'GHS', 'ZAR', 'KES'],
  capabilities: {
    deposits: true,
    noShowFees: false,
    tipping: false,
    subscriptions: true,
    recurring: true,
    threeDSecure: false,
  },
});

registerProvider(paystackProvider);
export default paystackProvider;
