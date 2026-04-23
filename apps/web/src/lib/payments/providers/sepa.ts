/**
 * SEPA (EU bank transfers via Stripe) — stub.
 * Country gate: FR and EU countries.
 * Stripe natively supports SEPA Direct Debit as a payment method type.
 * This provider is a thin wrapper that will configure Stripe payment intents
 * with payment_method_types: ['sepa_debit'].
 * TODO: Enable SEPA mandate flow via Stripe + webhook for sepa_debit events.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const EU_COUNTRIES = ['FR', 'DE', 'IT', 'ES', 'NL', 'BE', 'AT', 'PT', 'FI', 'IE', 'LU', 'GR'];
const EU_CURRENCIES = ['EUR'];

const sepaProvider = makeStub({
  id: 'sepa',
  displayName: {
    en: 'SEPA Bank Transfer',
    fr: 'Virement SEPA',
    ar: 'تحويل سيبا',
  },
  supportedCountries: EU_COUNTRIES,
  supportedCurrencies: EU_CURRENCIES,
  capabilities: {
    deposits: true,
    noShowFees: false,
    tipping: false,
    subscriptions: true,
    recurring: true,
    threeDSecure: false,
  },
});

registerProvider(sepaProvider);
export default sepaProvider;
