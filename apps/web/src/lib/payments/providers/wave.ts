/**
 * Wave (West Africa mobile money) — stub.
 * Country gate: SN, CI.
 * Wave is the leading mobile money service in Senegal and Côte d'Ivoire.
 * TODO: Integrate Wave Business API + webhook HMAC signature.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const waveProvider = makeStub({
  id: 'wave',
  displayName: {
    en: 'Wave Mobile Money',
    fr: 'Wave Mobile Money',
    ar: 'ويف للدفع المحمول',
  },
  supportedCountries: ['SN', 'CI', 'ML', 'BF', 'GN'],
  supportedCurrencies: ['XOF', 'GNF'],
  capabilities: {
    deposits: true,
    noShowFees: true,
    tipping: false,
    subscriptions: false,
    recurring: false,
    threeDSecure: false,
  },
});

registerProvider(waveProvider);
export default waveProvider;
