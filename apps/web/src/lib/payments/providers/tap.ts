/**
 * Tap Payments (UAE/SA/KW) — stub.
 * This is the ID stored in the DB seed for AE (country_config.payment_providers).
 * Country gate: AE, SA.
 * TODO: Integrate Tap Payments API + webhook HMAC signature.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const tapProvider = makeStub({
  id: 'tap',
  displayName: {
    en: 'Tap Payments',
    fr: 'Tap Payments',
    ar: 'تاب للمدفوعات',
  },
  supportedCountries: ['AE', 'SA', 'KW', 'BH', 'QA'],
  supportedCurrencies: ['AED', 'SAR', 'KWD', 'BHD', 'QAR'],
  capabilities: {
    deposits: true,
    noShowFees: true,
    tipping: true,
    subscriptions: false,
    recurring: false,
    threeDSecure: true,
  },
});

registerProvider(tapProvider);
export default tapProvider;
