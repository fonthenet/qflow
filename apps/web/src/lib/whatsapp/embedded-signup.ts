import 'server-only';

import {
  QFLO_WHATSAPP_TEMPLATES,
  buildTemplateCreatePayload,
  iterateTemplateLocales,
  type WhatsAppTemplateLocale,
} from '@qflo/shared';

const GRAPH_VERSION = 'v22.0';

export interface EmbeddedSignupEnv {
  appId: string;
  appSecret: string;
  configId: string;
  /** Public app id exposed to the browser (usually same as appId). */
  publicAppId: string;
}

/**
 * Returns the env config required for Embedded Signup, or null when any
 * piece is missing. When null, the feature is gracefully disabled and the
 * UI falls back to the manual credentials form / shared-number mode.
 *
 * This is the single gate: add all four env vars and the flow turns on.
 */
export function readEmbeddedSignupEnv(): EmbeddedSignupEnv | null {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  const configId = process.env.META_WA_CONFIG_ID?.trim();
  const publicAppId =
    process.env.NEXT_PUBLIC_META_APP_ID?.trim() || appId || '';
  if (!appId || !appSecret || !configId || !publicAppId) return null;
  return { appId, appSecret, configId, publicAppId };
}

export interface TokenExchangeResult {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/**
 * Exchange the short-lived auth code returned by Embedded Signup for a
 * long-lived system user access token scoped to the tenant's WABA.
 */
export async function exchangeAuthCode(
  code: string,
  env: EmbeddedSignupEnv,
): Promise<TokenExchangeResult> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  url.searchParams.set('client_id', env.appId);
  url.searchParams.set('client_secret', env.appSecret);
  url.searchParams.set('code', code);

  const res = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token) {
    throw new Error(
      `Token exchange failed (${res.status}): ${data?.error?.message ?? 'unknown error'}`,
    );
  }
  return data as TokenExchangeResult;
}

/** Subscribe the Qflo Meta App to receive webhooks for this WABA. */
export async function subscribeAppToWaba(
  wabaId: string,
  accessToken: string,
): Promise<void> {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(wabaId)}/subscribed_apps`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(
      `subscribed_apps failed (${res.status}): ${data?.error?.message ?? 'unknown error'}`,
    );
  }
}

/**
 * Register the phone number on the Cloud API. `pin` is a 6-digit code the
 * tenant chose during Embedded Signup; Meta stores it as two-step
 * verification on the number. We generate a deterministic random PIN per
 * number and store it alongside the credentials.
 */
export async function registerPhoneNumber(
  phoneNumberId: string,
  pin: string,
  accessToken: string,
): Promise<void> {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/register`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    },
  );
  const data = await res.json().catch(() => ({}));
  // Meta returns { success: true } on first register and also on re-register
  // of an already-registered number, so we treat both as success.
  if (!res.ok) {
    throw new Error(
      `phone register failed (${res.status}): ${data?.error?.message ?? 'unknown error'}`,
    );
  }
}

export interface TemplateProvisionResult {
  /** Per-template status keyed by `${name}:${locale}`. */
  statuses: Record<string, { status: string; id?: string; error?: string }>;
  /** Total attempted. */
  attempted: number;
  /** Number that returned a non-error status (pending/approved). */
  submitted: number;
}

/**
 * Submit every Qflo template in every supported locale to the tenant's WABA.
 *
 * Idempotent: Meta rejects re-submits of an already-existing template with a
 * specific error code which we treat as "already provisioned" and surface as
 * status=existing. Callers should persist the returned statuses on the org.
 */
export async function provisionTemplates(
  wabaId: string,
  accessToken: string,
): Promise<TemplateProvisionResult> {
  const statuses: TemplateProvisionResult['statuses'] = {};
  let attempted = 0;
  let submitted = 0;

  for (const { spec, locale } of iterateTemplateLocales()) {
    attempted += 1;
    const key = `${spec.name}:${locale}`;
    const payload = buildTemplateCreatePayload(spec, locale);
    try {
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(wabaId)}/message_templates`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.id) {
        statuses[key] = { status: String(data.status ?? 'PENDING'), id: String(data.id) };
        submitted += 1;
      } else if (data?.error?.error_subcode === 2388023 || data?.error?.code === 2388024) {
        // Meta's "template already exists" errors — treat as success.
        statuses[key] = { status: 'EXISTING' };
        submitted += 1;
      } else {
        statuses[key] = {
          status: 'ERROR',
          error: data?.error?.message ?? `status ${res.status}`,
        };
      }
    } catch (err) {
      statuses[key] = {
        status: 'ERROR',
        error: err instanceof Error ? err.message : 'network error',
      };
    }
  }

  return { statuses, attempted, submitted };
}

/** Generate a random 6-digit PIN for phone-number registration. */
export function generateRegistrationPin(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const n =
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return (n % 1_000_000).toString().padStart(6, '0');
}

/** Count of template+locale pairs Qflo attempts on each tenant. */
export function plannedTemplateCount(): number {
  let total = 0;
  for (const t of QFLO_WHATSAPP_TEMPLATES) {
    total += Object.keys(t.localizations).length;
  }
  return total;
}

/** Locale-keyed default template name used when sending outside 24h window. */
export function pickFallbackTemplateName(
  locale: WhatsAppTemplateLocale,
): string {
  // All locales share the same template name; only the `language` param differs.
  return QFLO_WHATSAPP_TEMPLATES[0]?.name ?? 'qflo_queue_update';
}
