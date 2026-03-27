import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Data Deletion — Qflo',
  description: 'Request deletion of your data from Qflo or check the status of a deletion request.',
};

export default function DataDeletionPage({
  searchParams,
}: {
  searchParams: { code?: string };
}) {
  const confirmationCode = searchParams.code;

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-foreground">
      <h1 className="mb-2 text-3xl font-bold">Data Deletion</h1>
      <p className="mb-10 text-sm text-muted-foreground">
        Manage your data deletion requests for Qflo.
      </p>

      {confirmationCode && (
        <div className="mb-8 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="text-lg font-semibold text-emerald-900">Deletion Request Confirmed</h2>
          <p className="mt-2 text-sm text-emerald-800">
            Your data deletion request has been received and is being processed.
          </p>
          <div className="mt-3 rounded-lg bg-white/60 px-4 py-3">
            <p className="text-xs font-medium text-emerald-700">Confirmation code</p>
            <p className="mt-1 font-mono text-sm font-bold text-emerald-900">{confirmationCode}</p>
          </div>
          <p className="mt-3 text-sm text-emerald-700">
            All data associated with your account will be permanently deleted within <strong>30 days</strong>.
            This includes any Messenger conversation data, notification records, and session information.
          </p>
        </div>
      )}

      <div className="space-y-8 text-[15px] leading-relaxed text-muted-foreground">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">What data do we store?</h2>
          <p>When you interact with Qflo through Facebook Messenger or WhatsApp, we may store:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Your Messenger or WhatsApp user identifier (not your personal Facebook profile data).</li>
            <li>Messages exchanged with our queue notification bot.</li>
            <li>Notification delivery records (timestamps and status).</li>
            <li>Queue ticket data linked to your conversation (ticket number, status, timestamps).</li>
          </ul>
          <p className="mt-3">
            We do <strong>not</strong> store your Facebook profile information, friends list, photos,
            or any data beyond what is needed to send you queue updates.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">How to request data deletion</h2>

          <h3 className="mb-2 mt-4 font-semibold text-foreground">Option 1: Through Facebook</h3>
          <p>
            Go to your{' '}
            <a
              href="https://www.facebook.com/settings?tab=applications"
              className="text-primary underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Facebook App Settings
            </a>{' '}
            and remove the Qflo app. This will automatically trigger a deletion request for all your
            Messenger data stored by Qflo.
          </p>

          <h3 className="mb-2 mt-4 font-semibold text-foreground">Option 2: Contact us directly</h3>
          <p>
            Send an email to{' '}
            <a href="mailto:privacy@qflo.net" className="text-primary underline">privacy@qflo.net</a>{' '}
            with the subject line &quot;Data Deletion Request&quot; and include any of the following
            identifiers so we can locate your data:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Your phone number (if you used WhatsApp notifications).</li>
            <li>The business name or location where you used Qflo.</li>
            <li>Approximate date of your visit.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">What happens after deletion</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>All your Messenger and WhatsApp session data is permanently deleted.</li>
            <li>All notification records linked to your conversations are removed.</li>
            <li>Any queue tickets linked to your contact information are anonymized.</li>
            <li>Deletion is completed within <strong>30 days</strong> of the request.</li>
            <li>Aggregated, anonymous analytics data (which cannot identify you) may be retained.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">Contact</h2>
          <p>
            For questions about data deletion or privacy, contact us at{' '}
            <a href="mailto:privacy@qflo.net" className="text-primary underline">privacy@qflo.net</a>.
          </p>
          <p className="mt-2">
            See also our{' '}
            <a href="/privacy" className="text-primary underline">Privacy Policy</a> and{' '}
            <a href="/terms" className="text-primary underline">Terms of Service</a>.
          </p>
        </section>
      </div>
    </div>
  );
}
