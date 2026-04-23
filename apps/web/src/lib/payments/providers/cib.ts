/**
 * CIB (Credit Populaire d'Algérie interbank e-payment) — stub.
 * Country gate: DZ only. Do not render this provider if org.country !== 'DZ'.
 * TODO: Integrate SATIM gateway CIB flow before going live.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const cibProvider = makeStub({
  id: 'cib',
  displayName: { en: 'CIB (Algeria)', fr: 'CIB (Algérie)', ar: 'بطاقة CIB' },
  supportedCountries: ['DZ'],
  supportedCurrencies: ['DZD'],
  capabilities: {
    deposits: true,
    noShowFees: true,
    tipping: false,
    subscriptions: false,
    recurring: false,
    threeDSecure: true,
  },
});

registerProvider(cibProvider);
export default cibProvider;
