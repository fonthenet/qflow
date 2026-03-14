export default function TermsPage() {
  return (
    <div className="bg-white text-[#111]">
      <section className="pt-28 pb-16 md:pt-32">
        <div className="mx-auto max-w-3xl px-6">
          <p className="text-[12px] font-medium uppercase tracking-[0.25em] text-[#bbb]">Legal</p>
          <h1 className="mt-3 text-3xl font-bold text-[#111] md:text-4xl">Terms of Service</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[#888]">
            These terms describe the baseline rules for using QueueFlow as a hosted software platform for business
            operations and visitor-facing service flows.
          </p>

          <div className="mt-10 space-y-8 rounded-xl border border-[#e8e8e8] bg-[#fafafa] p-6 md:p-8">
            <section>
              <h2 className="text-lg font-semibold text-[#111]">Use of the service</h2>
              <p className="mt-2 text-[13px] leading-7 text-[#888]">
                QueueFlow may be used by businesses, organizations, and their staff to manage arrivals, appointments,
                service visits, and customer communications. You agree to use the platform lawfully and not to misuse the
                service, interfere with other users, or attempt unauthorized access.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#111]">Customer data and content</h2>
              <p className="mt-2 text-[13px] leading-7 text-[#888]">
                Business customers control the content they collect and submit through QueueFlow. They remain responsible
                for the accuracy of that data, the notices they provide to visitors, and the instructions given to their
                staff and end users.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#111]">Billing and plan changes</h2>
              <p className="mt-2 text-[13px] leading-7 text-[#888]">
                Paid plans, limits, and included features are described on the pricing page. Plans may be upgraded,
                downgraded, or adjusted over time. If a custom commercial agreement exists, that agreement governs over
                this public summary.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#111]">Availability</h2>
              <p className="mt-2 text-[13px] leading-7 text-[#888]">
                We aim to keep QueueFlow available and reliable, but no public website can promise uninterrupted service
                in every case. Maintenance, third-party outages, and internet failures can affect availability.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#111]">Contact</h2>
              <p className="mt-2 text-[13px] leading-7 text-[#888]">
                For questions about these terms, billing, or commercial deployment, reach out through the contact page so
                the team can respond with the right workspace context.
              </p>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
