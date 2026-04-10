import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Metadata } from 'next';

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const supabase = createAdminClient();
  let { data: org } = await supabase
    .from('organizations')
    .select('name')
    .ilike('settings->>whatsapp_code', code)
    .single();
  // Fallback: try arabic_code
  if (!org) {
    ({ data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('settings->>arabic_code', code)
      .single());
  }

  return {
    title: org ? `Join ${org.name} Queue` : 'Join Queue',
    description: org
      ? `Scan to join the queue at ${org.name} via WhatsApp or Messenger`
      : 'Scan to join the queue',
  };
}

export default async function ScanJoinPage({ params }: PageProps) {
  const { code } = await params;
  const upperCode = code.toUpperCase();
  const supabase = createAdminClient();

  // Look up organization by whatsapp_code
  let { data: org } = await supabase
    .from('organizations')
    .select('id, name, logo_url, settings')
    .ilike('settings->>whatsapp_code', upperCode)
    .single();

  // Fallback: try arabic_code
  if (!org) {
    ({ data: org } = await supabase
      .from('organizations')
      .select('id, name, logo_url, settings')
      .eq('settings->>arabic_code', code)
      .single());
  }

  if (!org) notFound();

  const settings = (org.settings ?? {}) as Record<string, any>;
  if (settings.qr_code_enabled === false) notFound();
  const whatsappEnabled = Boolean(settings.whatsapp_enabled);
  const messengerEnabled = Boolean(settings.messenger_enabled);
  const messengerPageId = (settings.messenger_page_id as string) ?? '';

  // WhatsApp business number from env
  const whatsappPhone =
    process.env.WHATSAPP_SHARED_PHONE_NUMBER ??
    process.env.NEXT_PUBLIC_WHATSAPP_PHONE_NUMBER ??
    '';

  // Build deep links
  const waLink = whatsappPhone
    ? `https://wa.me/${whatsappPhone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`JOIN ${upperCode}`)}`
    : null;
  const msgLink = messengerPageId
    ? `https://m.me/${messengerPageId}?ref=JOIN_${upperCode}`
    : null;

  const showWhatsApp = whatsappEnabled && waLink;
  const showMessenger = messengerEnabled && msgLink;

  if (!showWhatsApp && !showMessenger) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
            <svg className="h-8 w-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h1 className="mb-2 text-xl font-bold text-slate-900">Queue Not Available</h1>
          <p className="text-sm text-slate-500">
            Messaging channels are not configured for this business.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-8 text-center">
          {org.logo_url ? (
            <img
              src={org.logo_url}
              alt={org.name}
              className="mx-auto mb-4 h-20 w-20 rounded-full object-cover shadow-md"
            />
          ) : (
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-blue-600 shadow-md">
              <span className="text-2xl font-bold text-white">
                {org.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <h1 className="text-2xl font-bold text-slate-900">{org.name}</h1>
          <p className="mt-2 text-sm text-slate-500">
            Join the queue instantly — pick your preferred app
          </p>
        </div>

        {/* Buttons */}
        <div className="space-y-4">
          {showWhatsApp && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#25D366] px-6 py-4 text-lg font-semibold text-white shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <svg className="h-7 w-7" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Join via WhatsApp
            </a>
          )}

          {showMessenger && (
            <a
              href={msgLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#0099FF] px-6 py-4 text-lg font-semibold text-white shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              <svg className="h-7 w-7" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.654V24l4.088-2.242c1.092.301 2.246.464 3.443.464 6.627 0 12-4.974 12-11.111C24 4.974 18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8.2l3.131 3.26 5.886-3.26-6.558 6.763z" />
              </svg>
              Join via Messenger
            </a>
          )}
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-slate-400">
          Powered by Qflo
        </p>
      </div>
    </div>
  );
}
