/**
 * Edahabia (Algérie Poste prepaid card) — stub.
 * Country gate: DZ only. Do not render this provider if org.country !== 'DZ'.
 * TODO: Integrate SATIM gateway Edahabia flow before going live.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const edahabiaProvider = makeStub({
  id: 'edahabia',
  displayName: {
    en: 'Edahabia (Algérie Poste)',
    fr: 'Edahabia (Algérie Poste)',
    ar: 'بطاقة الذهبية',
  },
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

registerProvider(edahabiaProvider);
export default edahabiaProvider;
