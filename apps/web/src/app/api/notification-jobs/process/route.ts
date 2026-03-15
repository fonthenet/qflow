import { NextRequest, NextResponse } from 'next/server';
import { processPendingNotificationJobs } from '@/lib/notification-jobs';

function isAuthorized(request: NextRequest) {
  const expected = process.env.NOTIFICATION_JOB_SECRET?.trim();
  if (!expected) {
    return true;
  }

  const provided =
    request.headers.get('x-notification-job-secret')?.trim() ||
    request.nextUrl.searchParams.get('secret')?.trim();

  return provided === expected;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await processPendingNotificationJobs();
  return NextResponse.json({ ok: true, ...result });
}

