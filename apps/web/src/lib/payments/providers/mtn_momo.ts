/**
 * MTN Mobile Money (West/Central/East Africa) — stub.
 * DB seed uses 'mtn-momo' (hyphen) for CI; both spellings are registered.
 * TODO: Integrate MTN MoMo API (Collections) + webhook HMAC-SHA256.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const mtnMomoProvider = makeStub({
  id: 'mtn_momo',
  displayName: {
    en: 'MTN Mobile Money',
    fr: 'MTN Mobile Money',
    ar: 'إم تي إن موبايل موني',
  },
  supportedCountries: ['CI', 'GH', 'CM', 'UG', 'RW', 'ZM', 'NG', 'BJ', 'CD', 'SN'],
  supportedCurrencies: ['XOF', 'GHS', 'XAF', 'UGX', 'RWF', 'ZMW', 'NGN'],
  capabilities: {
    deposits: true,
    noShowFees: false,
    tipping: false,
    subscriptions: false,
    recurring: false,
    threeDSecure: false,
  },
});

// Register under both spellings
registerProvider(mtnMomoProvider);
registerProvider({ ...mtnMomoProvider, id: 'mtn-momo' });

export default mtnMomoProvider;
