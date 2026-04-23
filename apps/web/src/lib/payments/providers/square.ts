/**
 * Square (US) — stub.
 * DB seed uses 'square' for US.
 * TODO: Integrate Square Payments API + webhook HMAC-SHA256 verification.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const squareProvider = makeStub({
  id: 'square',
  displayName: {
    en: 'Square',
    fr: 'Square',
    ar: 'سكوير',
  },
  supportedCountries: ['US', 'CA', 'AU', 'GB', 'IE', 'FR', 'ES', 'JP'],
  supportedCurrencies: ['USD', 'CAD', 'AUD', 'GBP', 'EUR', 'JPY'],
  capabilities: {
    deposits: true,
    noShowFees: false,
    tipping: true,
    subscriptions: true,
    recurring: true,
    threeDSecure: false,
  },
});

registerProvider(squareProvider);
export default squareProvider;
