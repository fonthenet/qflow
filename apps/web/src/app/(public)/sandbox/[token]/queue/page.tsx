import { notFound } from 'next/navigation';
import { SandboxFrame } from '@/components/sandbox/sandbox-frame';
import { SandboxQueueRuntime } from '@/components/sandbox/sandbox-queue-runtime';
import { getSandboxPreviewByToken, resetSandboxPreviewToStock } from '@/lib/platform/sandbox-preview';

interface SandboxQueuePageProps {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ ticket?: string; reset?: string }>;
}

export default async function SandboxQueuePage({
  params,
  searchParams,
}: SandboxQueuePageProps) {
  const { token } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const basePreview = await getSandboxPreviewByToken(token);
  const preview =
    basePreview && resolvedSearchParams?.reset ? resetSandboxPreviewToStock(basePreview) : basePreview;

  if (!preview) {
    notFound();
  }

  return (
    <SandboxFrame
      preview={preview}
      title="Queue Tracking Preview"
      subtitle={`See how ${preview.vocabulary.customerLabel.toLowerCase()}s follow their turn from phone or web in sandbox mode.`}
      resetHref={preview.links.queue}
    >
      <SandboxQueueRuntime preview={preview} initialTicketId={resolvedSearchParams?.ticket} />
    </SandboxFrame>
  );
}
