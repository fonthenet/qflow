import { PlatformSettingsClient } from './settings-client';

export default function PlatformSettingsPage() {
  const envVars = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Set' : 'Missing',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'Set' : 'Missing',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Set' : 'Missing',
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ? 'Set' : 'Missing',
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ? 'Set' : 'Missing',
    STRIPE_PRICE_STARTER_MONTHLY: process.env.STRIPE_PRICE_STARTER_MONTHLY ? 'Set' : 'Missing',
    STRIPE_PRICE_STARTER_YEARLY: process.env.STRIPE_PRICE_STARTER_YEARLY ? 'Set' : 'Missing',
    STRIPE_PRICE_GROWTH_MONTHLY: process.env.STRIPE_PRICE_GROWTH_MONTHLY ? 'Set' : 'Missing',
    STRIPE_PRICE_GROWTH_YEARLY: process.env.STRIPE_PRICE_GROWTH_YEARLY ? 'Set' : 'Missing',
    STRIPE_PRICE_PRO_MONTHLY: process.env.STRIPE_PRICE_PRO_MONTHLY ? 'Set' : 'Missing',
    STRIPE_PRICE_PRO_YEARLY: process.env.STRIPE_PRICE_PRO_YEARLY ? 'Set' : 'Missing',
    STRIPE_PRICE_ENTERPRISE_MONTHLY: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY ? 'Set' : 'Missing',
    STRIPE_PRICE_ENTERPRISE_YEARLY: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY ? 'Set' : 'Missing',
    RESEND_API_KEY: process.env.RESEND_API_KEY ? 'Set' : 'Missing',
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ? 'Set' : 'Missing',
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ? 'Set' : 'Missing',
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER ? 'Set' : 'Missing',
    PLATFORM_ADMIN_EMAILS: process.env.PLATFORM_ADMIN_EMAILS ? 'Set' : 'Missing',
  };

  return <PlatformSettingsClient envVars={envVars} />;
}
