/**
 * Flutterwave (Nigeria + Pan-Africa) — stub.
 * DB seed uses 'flutterwave' for NG.
 * TODO: Integrate Flutterwave v3 API + webhook HMAC-SHA256 verification.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const flutterwaveProvider = makeStub({
  id: 'flutterwave',
  displayName: {
    en: 'Flutterwave',
    fr: 'Flutterwave',
    ar: 'فلتر ويف',
  },
  supportedCountries: ['NG', 'GH', 'KE', 'ZA', 'UG', 'TZ', 'RW', 'CM', 'CI', 'SN'],
  supportedCurrencies: ['NGN', 'GHS', 'KES', 'ZAR', 'UGX', 'TZS', 'RWF', 'XAF', 'XOF'],
  capabilities: {
    deposits: true,
    noShowFees: false,
    tipping: false,
    subscriptions: false,
    recurring: false,
    threeDSecure: false,
  },
});

registerProvider(flutterwaveProvider);
export default flutterwaveProvider;
