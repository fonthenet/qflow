/**
 * Shared stub factory — produces a PaymentProvider skeleton that:
 * - Exports correct metadata (id, displayName, supportedCountries, capabilities)
 * - Throws NotImplementedError from createCheckout / refund
 * - Returns null from verifyWebhook (safe no-op for unimplemented providers)
 * - Sets isImplemented = false so UI can render "Coming soon" badges
 *
 * Each provider file calls makeStub() then passes the result to registerProvider().
 */

import { NotImplementedError } from '../provider';
import type { PaymentProvider, PaymentCapabilities } from '../provider';

export interface StubDescriptor {
  id: string;
  displayName: { en: string; fr: string; ar: string };
  supportedCountries: string[];
  supportedCurrencies: string[];
  capabilities: Partial<PaymentCapabilities>;
}

const DEFAULT_CAPABILITIES: PaymentCapabilities = {
  deposits: false,
  noShowFees: false,
  tipping: false,
  subscriptions: false,
  recurring: false,
  threeDSecure: false,
};

export function makeStub(desc: StubDescriptor): PaymentProvider {
  return {
    id: desc.id,
    displayName: desc.displayName,
    supportedCountries: desc.supportedCountries,
    supportedCurrencies: desc.supportedCurrencies,
    capabilities: { ...DEFAULT_CAPABILITIES, ...desc.capabilities },
    isImplemented: false,

    async createCheckout() {
      console.warn(`[${desc.id}] TODO: integrate ${desc.id}`);
      throw new NotImplementedError(desc.id, 'createCheckout');
    },

    async verifyWebhook(_rawBody: string, _signature: string | null) {
      console.warn(`[${desc.id}] TODO: integrate ${desc.id} webhooks`);
      return null;
    },

    async refund() {
      console.warn(`[${desc.id}] TODO: integrate ${desc.id} refunds`);
      throw new NotImplementedError(desc.id, 'refund');
    },

    // Default: stubs cannot resolve a customer org — no customer mapping exists.
    async resolveCustomerOrg(_event, _adminClient) {
      return null;
    },
  };
}
