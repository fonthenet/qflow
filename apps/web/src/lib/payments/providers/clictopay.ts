/**
 * Clictopay / SMT (Société Monétique Tunisie) — stub.
 * Country gate: TN only.
 * Also known as Clictopay — the national card network for Tunisia.
 * TODO: Integrate Clictopay redirect + HMAC signature.
 * Note: DB seed uses 'paymee' for TN; 'clictopay' is the task-spec alias.
 * Both IDs are registered so either can be looked up from country_config.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const clictopayProvider = makeStub({
  id: 'clictopay',
  displayName: {
    en: 'Clictopay (Tunisia)',
    fr: 'Clictopay (Tunisie)',
    ar: 'كليكتوباي',
  },
  supportedCountries: ['TN'],
  supportedCurrencies: ['TND'],
  capabilities: {
    deposits: true,
    noShowFees: true,
    tipping: false,
    subscriptions: false,
    recurring: false,
    threeDSecure: true,
  },
});

registerProvider(clictopayProvider);
export default clictopayProvider;
