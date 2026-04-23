/**
 * Network International (UAE) — stub.
 * Country gate: AE only.
 * Network International is the dominant card-acquiring network in the UAE.
 * TODO: Integrate NI hosted payment page + HMAC webhook signature.
 * Note: DB seed for AE uses 'tap'; this provider covers the NI rail
 * per task spec. Both are registered.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const networkInternationalProvider = makeStub({
  id: 'network_international',
  displayName: {
    en: 'Network International (UAE)',
    fr: 'Network International (EAU)',
    ar: 'نتورك إنترناشيونال',
  },
  supportedCountries: ['AE'],
  supportedCurrencies: ['AED'],
  capabilities: {
    deposits: true,
    noShowFees: true,
    tipping: false,
    subscriptions: false,
    recurring: false,
    threeDSecure: true,
  },
});

registerProvider(networkInternationalProvider);
export default networkInternationalProvider;
