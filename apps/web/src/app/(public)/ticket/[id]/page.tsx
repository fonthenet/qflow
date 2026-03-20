import { notFound, redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TicketByIdPage({ params }: PageProps) {
  const { id } = await params;

  // Validate UUID format to prevent injection
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  const supabase = createAdminClient();
  const { data: ticket } = await supabase
    .from('tickets')
    .select('qr_token')
    .eq('id', id)
    .single();

  if (!ticket?.qr_token) {
    // Ticket not synced yet or doesn't exist — show a waiting page
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <div className="w-full max-w-sm rounded-xl bg-card p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
            <svg className="h-6 w-6 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <h1 className="mb-2 text-xl font-bold text-foreground">Syncing Ticket...</h1>
          <p className="text-sm text-muted-foreground">
            Your ticket is being processed. This page will update automatically.
          </p>
          <meta httpEquiv="refresh" content="3" />
        </div>
      </div>
    );
  }

  // Redirect to the canonical tracking page
  redirect(`/q/${ticket.qr_token}`);
}
