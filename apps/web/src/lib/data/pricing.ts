export interface PlanFeature {
  name: string;
  free: boolean | string;
  starter: boolean | string;
  growth: boolean | string;
  pro: boolean | string;
  enterprise: boolean | string;
}

export interface Plan {
  id: string;
  name: string;
  price: number;
  yearlyPrice: number;
  description: string;
  highlight?: boolean;
  cta: string;
  limits: {
    customersPerMonth: number | -1;
    locations: number | -1;
    staff: number | -1;
  };
  features: string[];
}

export const plans: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    yearlyPrice: 0,
    description: 'Perfect for trying out QueueFlow',
    cta: 'Get Started Free',
    limits: { customersPerMonth: 50, locations: 1, staff: 2 },
    features: [
      'Up to 50 customers/month',
      '1 location',
      '2 staff members',
      'QR code check-in',
      'Unlimited push notifications',
      'Real-time queue updates',
      'Basic analytics',
      'Kiosk mode',
      'Display screen (1)',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 19,
    yearlyPrice: 15,
    description: 'For small businesses getting started',
    cta: 'Start Free Trial',
    limits: { customersPerMonth: 500, locations: 1, staff: 5 },
    features: [
      'Up to 500 customers/month',
      '1 location',
      '5 staff members',
      'Everything in Free, plus:',
      'Email notifications',
      'Custom branding basics',
      'CSV & PDF export',
      'Priority categories',
      'Customer intake forms',
      'Display screens (3)',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: 49,
    yearlyPrice: 39,
    description: 'For growing businesses with multiple needs',
    highlight: true,
    cta: 'Start Free Trial',
    limits: { customersPerMonth: 2000, locations: 3, staff: 15 },
    features: [
      'Up to 2,000 customers/month',
      '3 locations',
      '15 staff members',
      'Everything in Starter, plus:',
      'REST API access',
      'Webhooks',
      'Appointment scheduling',
      'Virtual queue (remote join)',
      'Group/family tickets',
      'Priority support',
      'Unlimited display screens',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 99,
    yearlyPrice: 79,
    description: 'For established businesses at scale',
    cta: 'Start Free Trial',
    limits: { customersPerMonth: 10000, locations: -1, staff: -1 },
    features: [
      'Up to 10,000 customers/month',
      'Unlimited locations',
      'Unlimited staff',
      'Everything in Growth, plus:',
      'White-label branding',
      'Custom QR codes (logo + colors)',
      'Advanced analytics & forecasting',
      'Multi-language support',
      'Custom display themes',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 199,
    yearlyPrice: 159,
    description: 'For large organizations with custom needs',
    cta: 'Contact Sales',
    limits: { customersPerMonth: -1, locations: -1, staff: -1 },
    features: [
      'Unlimited everything',
      'Everything in Pro, plus:',
      'Dedicated account manager',
      'Custom integrations',
      'SLA guarantee (99.9%)',
      'On-premise deployment option',
      'Training & onboarding',
      'Phone support',
    ],
  },
];

export const featureComparison: PlanFeature[] = [
  { name: 'Customers per month', free: '50', starter: '500', growth: '2,000', pro: '10,000', enterprise: 'Unlimited' },
  { name: 'Locations', free: '1', starter: '1', growth: '3', pro: 'Unlimited', enterprise: 'Unlimited' },
  { name: 'Staff members', free: '2', starter: '5', growth: '15', pro: 'Unlimited', enterprise: 'Unlimited' },
  { name: 'QR code check-in', free: true, starter: true, growth: true, pro: true, enterprise: true },
  { name: 'Push notifications', free: 'Unlimited', starter: 'Unlimited', growth: 'Unlimited', pro: 'Unlimited', enterprise: 'Unlimited' },
  { name: 'Real-time queue updates', free: true, starter: true, growth: true, pro: true, enterprise: true },
  { name: 'Kiosk mode', free: true, starter: true, growth: true, pro: true, enterprise: true },
  { name: 'Display screens (TV)', free: '1', starter: '3', growth: 'Unlimited', pro: 'Unlimited', enterprise: 'Unlimited' },
  { name: 'Analytics', free: 'Basic', starter: 'Full', growth: 'Full', pro: 'Advanced', enterprise: 'Advanced' },
  { name: 'CSV & PDF export', free: false, starter: true, growth: true, pro: true, enterprise: true },
  { name: 'Email notifications', free: false, starter: true, growth: true, pro: true, enterprise: true },
  { name: 'Custom branding', free: false, starter: 'Basic', growth: 'Basic', pro: 'Full', enterprise: 'Full' },
  { name: 'Priority categories', free: false, starter: true, growth: true, pro: true, enterprise: true },
  { name: 'Customer intake forms', free: false, starter: true, growth: true, pro: true, enterprise: true },
  { name: 'Appointment scheduling', free: false, starter: false, growth: true, pro: true, enterprise: true },
  { name: 'Virtual queue (remote)', free: false, starter: false, growth: true, pro: true, enterprise: true },
  { name: 'Group/family tickets', free: false, starter: false, growth: true, pro: true, enterprise: true },
  { name: 'REST API', free: false, starter: false, growth: true, pro: true, enterprise: true },
  { name: 'Webhooks', free: false, starter: false, growth: true, pro: true, enterprise: true },
  { name: 'White-label', free: false, starter: false, growth: false, pro: true, enterprise: true },
  { name: 'Custom QR codes', free: false, starter: false, growth: false, pro: true, enterprise: true },
  { name: 'Multi-language', free: false, starter: false, growth: false, pro: true, enterprise: true },
  { name: 'Dedicated support', free: false, starter: false, growth: false, pro: false, enterprise: true },
  { name: 'SLA guarantee', free: false, starter: false, growth: false, pro: false, enterprise: true },
  { name: 'On-premise option', free: false, starter: false, growth: false, pro: false, enterprise: true },
];
