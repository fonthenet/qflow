/**
 * CMI (Centre Monétique Interbancaire) — stub.
 * Country gate: MA only.
 * TODO: Integrate CMI hosted payment page + SHA256 signature verification.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const cmiProvider = makeStub({
  id: 'cmi',
  displayName: {
    en: 'CMI (Morocco)',
    fr: 'CMI (Maroc)',
    ar: 'بطاقة CMI',
  },
  supportedCountries: ['MA'],
  supportedCurrencies: ['MAD'],
  capabilities: {
    deposits: true,
    noShowFees: true,
    tipping: false,
    subscriptions: false,
    recurring: false,
    threeDSecure: true,
  },
});

registerProvider(cmiProvider);
export default cmiProvider;
