import { notFound } from 'next/navigation';
import { SandboxFrame } from '@/components/sandbox/sandbox-frame';
import { SandboxOverview } from '@/components/sandbox/sandbox-overview';
import { getSandboxPreviewByToken, resetSandboxPreviewToStock } from '@/lib/platform/sandbox-preview';

interface SandboxOverviewPageProps {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ reset?: string }>;
}

export default async function SandboxOverviewPage({
  params,
  searchParams,
}: SandboxOverviewPageProps) {
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
      title="Sandbox Preview"
      subtitle={`Test ${preview.template.title} across booking, kiosk, queue, and display before you launch ${preview.organization.name}.`}
      resetHref={preview.links.hub}
    >
      <SandboxOverview preview={preview} />
    </SandboxFrame>
  );
}
