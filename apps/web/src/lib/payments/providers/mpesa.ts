/**
 * M-Pesa (Safaricom Kenya) — stub.
 * Country gate: KE primarily; also used in TZ, UG, GH, EG.
 * TODO: Integrate Safaricom Daraja API (STK Push + C2B callbacks).
 * Webhook equivalent: Safaricom sends confirmation callbacks rather than
 * HMAC-signed webhooks — verify via registered callback URL + token.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const mpesaProvider = makeStub({
  id: 'mpesa',
  displayName: {
    en: 'M-Pesa',
    fr: 'M-Pesa',
    ar: 'إم-بيسا',
  },
  supportedCountries: ['KE', 'TZ', 'UG', 'GH', 'EG', 'MZ', 'LS'],
  supportedCurrencies: ['KES', 'TZS', 'UGX', 'GHS', 'EGP', 'MZN', 'LSL'],
  capabilities: {
    deposits: true,
    noShowFees: true,
    tipping: false,
    subscriptions: false,
    recurring: false,
    threeDSecure: false,
  },
});

registerProvider(mpesaProvider);
export default mpesaProvider;
