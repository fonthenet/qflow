/**
 * Razorpay (India) — stub.
 * Country gate: IN only.
 * Razorpay is the dominant payment gateway in India supporting UPI, cards,
 * netbanking, and wallets.
 * TODO: Integrate Razorpay Orders API + webhook HMAC-SHA256 signature.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const razorpayProvider = makeStub({
  id: 'razorpay',
  displayName: {
    en: 'Razorpay (India)',
    fr: 'Razorpay (Inde)',
    ar: 'رازورباي',
  },
  supportedCountries: ['IN'],
  supportedCurrencies: ['INR'],
  capabilities: {
    deposits: true,
    noShowFees: true,
    tipping: true,
    subscriptions: true,
    recurring: true,
    threeDSecure: true,
  },
});

registerProvider(razorpayProvider);
export default razorpayProvider;
