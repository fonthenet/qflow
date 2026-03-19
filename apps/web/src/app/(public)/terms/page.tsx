import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — QueueFlow',
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-foreground">
      <h1 className="mb-8 text-3xl font-bold">Terms of Service</h1>
      <p className="mb-4 text-sm text-muted-foreground">Last updated: March 2026</p>

      <div className="space-y-6 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">1. Acceptance</h2>
          <p>By using QueueFlow, you agree to these terms. If you do not agree, do not use the service.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">2. Service Description</h2>
          <p>QueueFlow is a queue management platform that allows businesses to manage customer queues and allows customers to join queues, track their position, and receive notifications. The service is provided as-is.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">3. User Accounts</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Staff accounts are created by organization administrators</li>
            <li>You are responsible for keeping your credentials secure</li>
            <li>Customers can use QueueFlow without creating an account</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">4. Acceptable Use</h2>
          <p>You agree not to misuse the service, including but not limited to: creating fake tickets, interfering with queue order, or attempting to access other users&apos; data.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">5. Data & Privacy</h2>
          <p>Your use of QueueFlow is also governed by our <a href="/privacy" className="text-primary underline">Privacy Policy</a>. We handle your data responsibly and never sell it to third parties.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">6. Limitation of Liability</h2>
          <p>QueueFlow is provided as-is without warranty. We are not liable for missed notifications, incorrect wait times, or service interruptions. We do our best to maintain high availability but cannot guarantee uninterrupted service.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">7. Account Deletion</h2>
          <p>You can request deletion of your account and data at any time by contacting <a href="mailto:support@queueflow.com" className="text-primary underline">support@queueflow.com</a>. We will process deletion requests within 30 days.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">8. Changes to Terms</h2>
          <p>We may update these terms from time to time. Continued use of the service after changes constitutes acceptance of the updated terms.</p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-foreground">9. Contact</h2>
          <p>For questions about these terms, contact us at <a href="mailto:support@queueflow.com" className="text-primary underline">support@queueflow.com</a>.</p>
        </section>
      </div>
    </div>
  );
}
