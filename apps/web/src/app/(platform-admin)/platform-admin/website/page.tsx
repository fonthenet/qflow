import { WebsiteConfigClient } from './website-client';

export default function WebsiteConfigPage() {
  // Read current marketing config from env or defaults
  const config = {
    siteName: process.env.NEXT_PUBLIC_SITE_NAME || 'QueueFlow',
    siteDescription: process.env.NEXT_PUBLIC_SITE_DESCRIPTION || 'Modern Arrival and Visit Management',
    contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || '',
    supportUrl: process.env.NEXT_PUBLIC_SUPPORT_URL || '',
    twitterHandle: process.env.NEXT_PUBLIC_TWITTER || '',
    linkedInUrl: process.env.NEXT_PUBLIC_LINKEDIN || '',
    signupsEnabled: process.env.SIGNUPS_ENABLED !== 'false',
    defaultPlan: process.env.DEFAULT_PLAN || 'free',
    trialDays: parseInt(process.env.TRIAL_DAYS || '14', 10),
    maintenanceMode: process.env.MAINTENANCE_MODE === 'true',
  };

  return <WebsiteConfigClient config={config} />;
}
