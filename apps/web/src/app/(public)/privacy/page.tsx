import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — Qflo',
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-foreground">
      <h1 className="mb-8 text-3xl font-bold">Privacy Policy</h1>
      <p className="mb-4 text-sm text-muted-foreground">Last updated: March 2026</p>

      <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">1. What We Collect</h2>
          <p>Qflo collects only what is necessary to manage your queue experience:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><strong>Ticket data</strong> — ticket number, status, position, timestamps</li>
            <li><strong>Optional contact info</strong> — name, phone, or email if you provide them</li>
            <li><strong>Device tokens</strong> — for push notifications, only if you opt in</li>
            <li><strong>Usage data</strong> — anonymous analytics to improve the service</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">2. How We Use Your Data</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>To manage your position in the queue and notify you when it is your turn</li>
            <li>To display your ticket on waiting room screens</li>
            <li>To send push notifications about your queue status (opt-in only)</li>
            <li>To generate anonymous statistics for businesses using Qflo</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">3. Data Storage & Security</h2>
          <p>Your data is stored securely on Supabase (hosted on AWS) with encryption at rest and in transit. Ticket data is automatically deleted after 90 days. We never sell your data to third parties.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">4. Your Rights</h2>
          <p>You can request deletion of your data at any time by contacting us at <a href="mailto:support@queueflow.com" className="text-primary underline">support@queueflow.com</a>. If you are in the EU, you have additional rights under GDPR including access, rectification, and portability.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">5. Cookies & Tracking</h2>
          <p>Qflo does not use third-party tracking cookies. We use essential cookies only for authentication and session management.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">6. Contact</h2>
          <p>For privacy questions, contact us at <a href="mailto:support@queueflow.com" className="text-primary underline">support@queueflow.com</a>.</p>
        </section>
      </div>
    </div>
  );
}
