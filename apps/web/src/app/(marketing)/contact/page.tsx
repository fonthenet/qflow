'use client';

import { useState } from 'react';
import { Mail, MessageSquare, MapPin, Send, Check } from 'lucide-react';

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
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-white">
      {/* Hero */}
      <section className="pb-16 pt-20 md:pt-28">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <p className="text-[13px] font-semibold uppercase tracking-widest text-gray-400">Contact</p>
          <h1 className="mt-3 text-4xl font-bold tracking-[-0.03em] text-gray-900 md:text-5xl">
            Get in touch
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-7 text-gray-500">
            Have questions about QueueFlow? Want a demo? We&apos;d love to hear from you.
          </p>
        </div>
      </section>

      <section className="pb-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-12 lg:grid-cols-2">
            {/* Contact Form */}
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Send us a message</h2>
              <p className="mt-1 text-[13px] text-gray-500">
                We typically respond within 24 hours.
              </p>

              {sent ? (
                <div className="mt-8 rounded-2xl border border-emerald-100 bg-emerald-50 p-8 text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                    <Check className="h-6 w-6 text-emerald-600" />
                  </div>
                  <h3 className="text-base font-semibold text-gray-900">Message sent!</h3>
                  <p className="mt-2 text-[13px] text-gray-500">
                    Thank you for reaching out. We&apos;ll get back to you shortly.
                  </p>
                  <button
                    onClick={() => setSent(false)}
                    className="mt-4 text-[13px] font-medium text-gray-900 hover:text-gray-700"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-[13px] font-medium text-gray-700">Name *</label>
                      <input
                        type="text"
                        required
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
                        placeholder="Your name"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[13px] font-medium text-gray-700">Email *</label>
                      <input
                        type="email"
                        required
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
                        placeholder="you@company.com"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-gray-700">Company</label>
                    <input
                      type="text"
                      value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                      className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
                      placeholder="Your company name"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-gray-700">Message *</label>
                    <textarea
                      required
                      rows={5}
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      className="w-full resize-none rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
                      placeholder="How can we help you?"
                    />
                  </div>

                  {error && (
                    <p className="text-[13px] text-red-500">{error}</p>
                  )}

                  <button
                    type="submit"
                    disabled={sending}
                    className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
                  >
                    {sending ? 'Sending...' : 'Send message'}
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </form>
              )}
            </div>

            {/* Contact Info */}
            <div className="space-y-6 lg:pt-8">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Other ways to reach us</h2>
                <p className="mt-1 text-[13px] text-gray-500">
                  Pick the method that works best for you.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex gap-4 rounded-xl border border-gray-100 bg-white p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Email</h3>
                    <p className="mt-0.5 text-[13px] text-gray-600">support@queueflow.com</p>
                    <p className="text-[11px] text-gray-400">Response within 24 hours</p>
                  </div>
                </div>

                <div className="flex gap-4 rounded-xl border border-gray-100 bg-white p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Live Chat</h3>
                    <p className="mt-0.5 text-[13px] text-gray-600">Available Mon-Fri, 9am-6pm CET</p>
                    <p className="text-[11px] text-gray-400">Average response time: 5 minutes</p>
                  </div>
                </div>

                <div className="flex gap-4 rounded-xl border border-gray-100 bg-white p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
                    <MapPin className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Location</h3>
                    <p className="mt-0.5 text-[13px] text-gray-600">Based in Algeria, serving businesses worldwide</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
