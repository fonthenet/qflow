import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — Qflo',
  description: 'Terms and conditions for using the Qflo queue management platform.',
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 text-foreground">
      <h1 className="mb-2 text-3xl font-bold">Terms of Service</h1>
      <p className="mb-10 text-sm text-muted-foreground">Effective date: 27 March 2026 · Last updated: 27 March 2026</p>

      <div className="space-y-8 text-[15px] leading-relaxed text-muted-foreground">
        {/* ── Introduction ── */}
        <section>
          <p>
            These Terms of Service (&quot;Terms&quot;) govern your access to and use of the Qflo platform,
            including the website at <strong>qflo.net</strong>, the Qflo mobile applications, the Qflo Station
            desktop application, kiosk interfaces, and all related services (collectively, the &quot;Service&quot;).
            The Service is operated by Qflo (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;).
          </p>
          <p className="mt-3">
            By accessing or using the Service, you agree to be bound by these Terms. If you do not agree, you
            must not use the Service.
          </p>
        </section>

        {/* ── 1. Definitions ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">1. Definitions</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>&quot;Organization&quot;</strong> — a business, clinic, restaurant, government office, or other entity that uses Qflo to manage queues and appointments.</li>
            <li><strong>&quot;Operator&quot;</strong> — a staff member, administrator, or agent acting on behalf of an Organization.</li>
            <li><strong>&quot;Visitor&quot;</strong> — any person who joins a queue, books an appointment, or receives a ticket through the Service.</li>
            <li><strong>&quot;Kiosk&quot;</strong> — a self-service interface (web-based or on-premise) through which Visitors take tickets or check in.</li>
          </ul>
        </section>

        {/* ── 2. Eligibility ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">2. Eligibility</h2>
          <p>
            You must be at least 16 years old to create an Operator account. Visitors may use the Service
            without an account. By creating an account on behalf of an Organization, you represent that you
            have the authority to bind that Organization to these Terms.
          </p>
        </section>

        {/* ── 3. Service Description ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">3. Service Description</h2>
          <p>Qflo provides a queue management and appointment scheduling platform that enables Organizations to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Issue and manage queue tickets through kiosks, QR codes, or online links.</li>
            <li>Call, serve, transfer, and complete visitor tickets from a dashboard.</li>
            <li>Display real-time queue status on waiting room screens.</li>
            <li>Send queue notifications via WhatsApp, Facebook Messenger, and push notifications.</li>
            <li>Schedule and manage appointments with online booking.</li>
            <li>Generate analytics and reports on queue performance.</li>
          </ul>
          <p className="mt-3">
            The Service is provided on an &quot;as-is&quot; and &quot;as-available&quot; basis. We continuously
            improve the Service and may add, modify, or discontinue features with reasonable notice.
          </p>
        </section>

        {/* ── 4. Accounts & Security ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">4. Accounts &amp; Security</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Operator accounts are created by Organization administrators or through self-registration.</li>
            <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
            <li>You must notify us immediately if you suspect unauthorized access to your account.</li>
            <li>We reserve the right to suspend or terminate accounts that violate these Terms.</li>
            <li>Visitors can use the Service (take tickets, track queues) without creating an account.</li>
          </ul>
        </section>

        {/* ── 5. Acceptable Use ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">5. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Create fake or fraudulent tickets to disrupt queue operations.</li>
            <li>Attempt to manipulate queue positions or bypass the normal queue order.</li>
            <li>Access, modify, or delete data belonging to other users or Organizations without authorization.</li>
            <li>Use the Service to send unsolicited messages, spam, or promotional content through notification channels.</li>
            <li>Reverse-engineer, decompile, or attempt to extract the source code of the Service.</li>
            <li>Use automated scripts, bots, or scrapers to interact with the Service without our written permission.</li>
            <li>Overload, disrupt, or interfere with the Service or its underlying infrastructure.</li>
            <li>Use the Service for any illegal purpose or in violation of applicable laws.</li>
          </ul>
        </section>

        {/* ── 6. Messaging & Notifications ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">6. Messaging &amp; Notifications</h2>
          <p>
            The Service may send notifications through WhatsApp, Facebook Messenger, and push notifications.
            By providing your phone number or interacting with our Messenger bot, you consent to receiving
            queue-related messages through these channels.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Notifications are limited to queue status updates (ticket called, position updates, service completion).</li>
            <li>We do not send marketing or promotional messages through these channels.</li>
            <li>You can opt out at any time by not providing contact information, blocking the WhatsApp number, or unsubscribing from the Messenger bot.</li>
            <li>Message delivery depends on third-party platforms (Meta) and is not guaranteed.</li>
          </ul>
          <p className="mt-3">
            Organizations are responsible for informing their visitors about the availability and nature
            of notifications in their queue setup.
          </p>
        </section>

        {/* ── 7. Data & Privacy ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">7. Data &amp; Privacy</h2>
          <p>
            Your use of the Service is also governed by our{' '}
            <a href="/privacy" className="text-primary underline">Privacy Policy</a>, which describes how
            we collect, use, store, and protect personal data. By using the Service, you acknowledge that
            you have read and understood the Privacy Policy.
          </p>
          <p className="mt-3">
            Organizations using Qflo are data controllers for the visitor data collected through their queues.
            Organizations are responsible for complying with applicable data protection laws (including GDPR,
            where applicable) and for informing visitors about their data practices.
          </p>
        </section>

        {/* ── 8. Intellectual Property ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">8. Intellectual Property</h2>
          <p>
            The Service, including its design, code, features, logos, and documentation, is owned by Qflo
            and protected by intellectual property laws. You may not copy, modify, distribute, or create
            derivative works based on the Service without our written permission.
          </p>
          <p className="mt-3">
            Your data remains yours. We claim no ownership over the data you or your visitors submit
            through the Service.
          </p>
        </section>

        {/* ── 9. Service Availability ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">9. Service Availability</h2>
          <p>
            We strive to maintain high availability but do not guarantee uninterrupted or error-free operation.
            The Service may be temporarily unavailable due to maintenance, updates, or circumstances beyond our
            control. We will make reasonable efforts to provide advance notice of planned downtime.
          </p>
        </section>

        {/* ── 10. Limitation of Liability ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">10. Limitation of Liability</h2>
          <p>To the maximum extent permitted by law:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>The Service is provided &quot;as-is&quot; and &quot;as-available&quot; without warranties of any kind, express or implied.</li>
            <li>We are not liable for missed notifications, incorrect wait time estimates, or delays in queue processing.</li>
            <li>We are not liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service.</li>
            <li>Our total liability for any claim related to the Service shall not exceed the amount you paid us in the 12 months preceding the claim, or $100 USD, whichever is greater.</li>
          </ul>
          <p className="mt-3">
            Nothing in these Terms excludes or limits liability for fraud, gross negligence, or any liability
            that cannot be excluded under applicable law.
          </p>
        </section>

        {/* ── 11. Indemnification ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">11. Indemnification</h2>
          <p>
            Organizations agree to indemnify and hold Qflo harmless from any claims, damages, or expenses
            (including legal fees) arising from: (a) their use of the Service, (b) violation of these Terms,
            (c) violation of applicable laws, or (d) any dispute between the Organization and its visitors.
          </p>
        </section>

        {/* ── 12. Account Deletion ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">12. Account Deletion</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Organization administrators can request account and data deletion at any time.</li>
            <li>Upon deletion, all associated data (tickets, appointments, staff accounts, settings) will be permanently removed within 30 days.</li>
            <li>Aggregated, anonymized analytics data that cannot be linked to individuals may be retained.</li>
            <li>To request deletion, contact <a href="mailto:support@qflo.net" className="text-primary underline">support@qflo.net</a>.</li>
          </ul>
        </section>

        {/* ── 13. Termination ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">13. Termination</h2>
          <p>
            We may suspend or terminate your access to the Service at any time if you violate these Terms,
            engage in abusive behavior, or if required by law. Upon termination, your right to use the
            Service ceases immediately. Provisions that by their nature should survive termination (including
            Limitation of Liability, Indemnification, and Governing Law) will continue to apply.
          </p>
        </section>

        {/* ── 14. Changes to Terms ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">14. Changes to Terms</h2>
          <p>
            We may update these Terms from time to time. We will notify you of material changes by posting
            the updated Terms on this page and updating the &quot;Last updated&quot; date. For significant
            changes, we may also notify registered users by email. Continued use of the Service after
            changes constitutes acceptance of the revised Terms.
          </p>
        </section>

        {/* ── 15. Governing Law ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">15. Governing Law</h2>
          <p>
            These Terms are governed by and construed in accordance with applicable law. Any disputes
            arising from these Terms or the Service shall first be attempted to be resolved through
            good-faith negotiation. If negotiation fails, disputes shall be resolved through binding
            arbitration or in a court of competent jurisdiction.
          </p>
        </section>

        {/* ── 16. Contact ── */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-foreground">16. Contact</h2>
          <p>For questions about these Terms:</p>
          <ul className="mt-2 space-y-1 pl-5">
            <li>Email: <a href="mailto:support@qflo.net" className="text-primary underline">support@qflo.net</a></li>
            <li>Privacy matters: <a href="mailto:privacy@qflo.net" className="text-primary underline">privacy@qflo.net</a></li>
          </ul>
        </section>
      </div>
    </div>
  );
}
