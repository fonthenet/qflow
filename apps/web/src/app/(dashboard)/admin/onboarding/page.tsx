import { redirect } from 'next/navigation';

export default function PlatformOnboardingPage() {
  redirect('/admin/setup-wizard');
}
