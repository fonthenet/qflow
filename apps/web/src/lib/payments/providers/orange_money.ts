/**
 * Orange Money (West/East Africa) — stub.
 * The DB seed uses 'orange-money' (hyphen) for SN; this file also registers
 * 'orange_money' (underscore) per task spec. Both IDs are registered.
 * TODO: Integrate Orange Money API + webhook HMAC signature.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const orangeMoneyProvider = makeStub({
  id: 'orange_money',
  displayName: {
    en: 'Orange Money',
    fr: 'Orange Money',
    ar: 'أورنج موني',
  },
  supportedCountries: ['SN', 'CI', 'CM', 'ML', 'GN', 'BF', 'CD', 'MG', 'GH', 'LR', 'SL'],
  supportedCurrencies: ['XOF', 'XAF', 'GHS', 'GNF'],
  capabilities: {
    deposits: true,
    noShowFees: false,
    tipping: false,
    subscriptions: false,
    recurring: false,
    threeDSecure: false,
  },
});

// Register under both spellings so country_config rows using either ID work
registerProvider(orangeMoneyProvider);
registerProvider({ ...orangeMoneyProvider, id: 'orange-money' });

export default orangeMoneyProvider;
