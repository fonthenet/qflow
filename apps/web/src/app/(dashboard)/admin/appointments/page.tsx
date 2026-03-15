import { ScheduledArrivalsClient } from '../scheduled-arrivals-client';
import { getScheduledArrivalsPageData } from '../scheduled-arrivals-data';

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ office?: string; date?: string }>;
}) {
  const params = await searchParams;
  const data = await getScheduledArrivalsPageData(params);

  return (
    <ScheduledArrivalsClient
      {...data}
      variant="appointments"
      basePath="/admin/appointments"
    />
  );
}
