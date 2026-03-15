export default function PrivacyPage() {
  return (
    <div className="bg-white text-[#111]">
      <section className="pt-28 pb-16 md:pt-32">
        <div className="mx-auto max-w-3xl px-6">
          <p className="text-[12px] font-medium uppercase tracking-[0.25em] text-[#bbb]">Privacy</p>
          <h1 className="mt-3 text-3xl font-bold text-[#111] md:text-4xl">Privacy Policy</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[#888]">
            This policy explains how QueueFlow handles data for business customers, staff users, and visitors who join a
            service flow through the platform.
          </p>

          <div className="mt-10 space-y-8 rounded-xl border border-[#e8e8e8] bg-[#fafafa] p-6 md:p-8">
            <section>
              <h2 className="text-lg font-semibold text-[#111]">What we collect</h2>
              <p className="mt-2 text-[13px] leading-7 text-[#888]">
                QueueFlow stores account details for workspace owners and staff, along with the visit information a
                business chooses to collect from its customers or visitors. This can include names, contact details,
                service selections, timing data, and operational status updates.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#111]">How the data is used</h2>
              <p className="mt-2 text-[13px] leading-7 text-[#888]">
                Data is used to operate the service, route visitors to the correct team, send live updates, generate
                analytics, and help businesses manage service delivery. We do not sell visitor data.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#111]">Business responsibility</h2>
              <p className="mt-2 text-[13px] leading-7 text-[#888]">
                Each business using QueueFlow is responsible for collecting only the information it needs, keeping its
                notices current, and using the platform in line with local privacy and consumer-protection requirements.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#111]">Security and retention</h2>
              <p className="mt-2 text-[13px] leading-7 text-[#888]">
                We use commercially reasonable safeguards to protect service data. Records are retained only as long as
                needed for product operation, reporting, support, and the account settings chosen by the customer.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-[#111]">Questions</h2>
              <p className="mt-2 text-[13px] leading-7 text-[#888]">
                For privacy questions or requests, contact the QueueFlow team through the contact page and include the
                workspace or organization name involved.
              </p>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
