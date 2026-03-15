import { redirect } from 'next/navigation';

export default async function VisitsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams(params).toString();
  redirect(`/admin/queue${qs ? `?${qs}` : ''}`);
}
