/**
 * Paytm (India) — stub.
 * Country gate: IN only.
 * This ID is in the DB seed for IN (country_config.payment_providers).
 * TODO: Integrate Paytm Payment Gateway + webhook checksum verification.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const paytmProvider = makeStub({
  id: 'paytm',
  displayName: {
    en: 'Paytm (India)',
    fr: 'Paytm (Inde)',
    ar: 'باي تي إم',
  },
  supportedCountries: ['IN'],
  supportedCurrencies: ['INR'],
  capabilities: {
    deposits: true,
    noShowFees: false,
    tipping: false,
    subscriptions: false,
    recurring: false,
    threeDSecure: false,
  },
});

registerProvider(paytmProvider);
export default paytmProvider;
