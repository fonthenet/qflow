'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, Check, Mail, MessageSquare, Send, Sparkles } from 'lucide-react';
import { Sora } from 'next/font/google';

const display = Sora({
  subsets: ['latin'],
});

const contactPaths = [
  {
    title: 'Product walkthrough',
    description: 'See how the command center, onboarding flow, and customer journey fit your category.',
    icon: Sparkles,
  },
  {
    title: 'Launch planning',
    description: 'Get help mapping locations, arrival modes, bookings, and rollout steps for the first workspace.',
    icon: MessageSquare,
  },
  {
    title: 'Sales and support',
    description: 'Talk through pricing, implementation, or enterprise rollout needs with the QueueFlow team.',
    icon: Mail,
  },
];

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', company: '', message: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError('');

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to send message');
      }

      setSent(true);
      setForm({ name: '', email: '', company: '', message: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-[#f6f1ea] text-slate-900">
      <section className="border-b border-black/5 bg-[radial-gradient(circle_at_top_left,_rgba(255,241,226,0.95),_rgba(246,241,234,0)_38%),radial-gradient(circle_at_right,_rgba(199,232,223,0.7),_rgba(246,241,234,0)_36%),linear-gradient(180deg,_#f8f4ee_0%,_#f6f1ea_100%)]">
        <div className="mx-auto max-w-7xl px-6 py-18 md:py-24">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-400">Contact</p>
            <h1 className={`${display.className} mt-4 text-[clamp(2.4rem,5vw,4.8rem)] leading-[0.98] tracking-[-0.055em] text-[#101717]`}>
              Let&apos;s map the customer flow your business actually needs.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-[16px] leading-7 text-slate-600">
              Whether you are rebuilding signup, launching the first workspace, or planning a multi-site rollout, we can help shape the right QueueFlow setup.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-18 md:grid-cols-[1.1fr_0.9fr] md:items-start md:py-22">
          <div className="rounded-[34px] border border-slate-200 bg-[#fbfaf8] p-6 shadow-[0_14px_30px_rgba(20,27,26,0.04)] md:p-8">
            <div className="max-w-2xl">
              <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-slate-400">Send a note</p>
              <h2 className={`${display.className} mt-3 text-[clamp(1.9rem,4vw,3rem)] leading-[1] tracking-[-0.05em] text-[#111716]`}>
                Tell us what you&apos;re rebuilding.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                Share your category, the arrival modes you run today, and where the operation gets stuck. We typically reply within one business day.
              </p>
            </div>

            {sent ? (
              <div className="mt-8 rounded-[28px] border border-emerald-200 bg-emerald-50 p-8 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-sm">
                  <Check className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-xl font-semibold text-slate-900">Message sent</h3>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  We have your note and will follow up shortly.
                </p>
                <button
                  type="button"
                  onClick={() => setSent(false)}
                  className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Name</label>
                    <input
                      type="text"
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#10292f] focus:ring-2 focus:ring-[#10292f]/10"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Work email</label>
                    <input
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#10292f] focus:ring-2 focus:ring-[#10292f]/10"
                      placeholder="you@company.com"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Company</label>
                  <input
                    type="text"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                    className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#10292f] focus:ring-2 focus:ring-[#10292f]/10"
                    placeholder="Business or organization name"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">What do you need help with?</label>
                  <textarea
                    required
                    rows={6}
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    className="w-full resize-none rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#10292f] focus:ring-2 focus:ring-[#10292f]/10"
                    placeholder="Describe your business, current workflow, and what you want QueueFlow to handle."
                  />
                </div>

                {error && (
                  <p className="rounded-[18px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={sending}
                  className="inline-flex items-center gap-2 rounded-full bg-[#10292f] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#18383f] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sending ? 'Sending...' : 'Send message'}
                  <Send className="h-4 w-4" />
                </button>
              </form>
            )}
          </div>

          <div className="space-y-4">
            {contactPaths.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(20,27,26,0.04)]">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#10292f] text-white">
                    <Icon className="h-5 w-5" />
                  </div>
                  <p className="mt-4 text-lg font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-2 text-sm leading-7 text-slate-600">{item.description}</p>
                </div>
              );
            })}

            <div className="rounded-[30px] border border-black/5 bg-[#10292f] p-6 text-white shadow-[0_16px_32px_rgba(20,27,26,0.08)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Direct email</p>
              <a href="mailto:support@queueflow.com" className={`${display.className} mt-3 block text-2xl tracking-[-0.04em] text-white`}>
                support@queueflow.com
              </a>
              <p className="mt-3 text-sm leading-7 text-white/75">
                Use email if you already know what you need or want to send rollout context ahead of a deeper conversation.
              </p>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-[#fbfaf8] p-6 shadow-[0_14px_30px_rgba(20,27,26,0.04)]">
              <p className="text-sm font-semibold text-slate-900">Prefer to start self-serve?</p>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                You can create the workspace now, choose your category, and let the onboarding flow draft the first operating model.
              </p>
              <Link
                href="/register"
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#10292f] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#18383f]"
              >
                Create your workspace
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
