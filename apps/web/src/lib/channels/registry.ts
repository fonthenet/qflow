import 'server-only';
import { ChannelAdapter } from './types';
import { lineAdapter } from './line';
import { kakaoAdapter } from './kakao';
import { zaloAdapter } from './zalo';

/**
 * Global channel adapter registry.
 * Country/org config selects a channel by key.
 * WhatsApp and Messenger remain their own modules (legacy layout);
 * future channels register here.
 */
const registry = new Map<string, ChannelAdapter>([
  ['line', lineAdapter],
  ['kakao', kakaoAdapter],
  ['zalo', zaloAdapter],
]);

export function getAdapter(channel: string): ChannelAdapter | undefined {
  return registry.get(channel);
}

export function registerAdapter(adapter: ChannelAdapter): void {
  registry.set(adapter.channel, adapter);
}

export function listChannels(): string[] {
  return Array.from(registry.keys());
}
