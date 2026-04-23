/**
 * SATIM gateway (Société d'Automatisation des Transactions Interbancaires et de
 * Monétique) — stub.
 * Country gate: DZ only.
 * SATIM is the underlying gateway for both CIB and Edahabia; this provider
 * represents the gateway-level integration (redirect-based hosted checkout).
 * TODO: Integrate SATIM HTTPS redirect flow + HMAC signature verification.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const satimProvider = makeStub({
  id: 'satim',
  displayName: {
    en: 'SATIM Gateway (Algeria)',
    fr: 'Passerelle SATIM (Algérie)',
    ar: 'بوابة ساتيم',
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

registerProvider(satimProvider);
export default satimProvider;
