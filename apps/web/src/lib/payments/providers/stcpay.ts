/**
 * STCPay (Saudi Arabia) — stub.
 * Country gate: SA only.
 * STCPay is a mobile wallet widely used in Saudi Arabia.
 * This ID is in the DB seed for SA (country_config.payment_providers).
 * TODO: Integrate STCPay API + webhook signature verification.
 */
import { makeStub } from './_stub';
import { registerProvider } from '../registry';

const stcpayProvider = makeStub({
  id: 'stcpay',
  displayName: {
    en: 'STCPay (Saudi Arabia)',
    fr: 'STCPay (Arabie saoudite)',
    ar: 'اس تي سي باي',
  },
  supportedCountries: ['SA'],
  supportedCurrencies: ['SAR'],
  capabilities: {
    deposits: true,
    noShowFees: false,
    tipping: false,
    subscriptions: false,
    recurring: false,
    threeDSecure: false,
  },
});

registerProvider(stcpayProvider);
export default stcpayProvider;
