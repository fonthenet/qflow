import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

function slugifyOfficeName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function matchesOfficePublicSlug(
  office: { name: string; settings?: unknown },
  slug: string
) {
  const settings =
    office.settings && typeof office.settings === 'object' && !Array.isArray(office.settings)
      ? (office.settings as Record<string, unknown>)
      : {};
  const configuredSlug = settings.platform_office_slug;
  const effectiveSlug =
    typeof configuredSlug === 'string' && configuredSlug.trim().length > 0
      ? configuredSlug
      : slugifyOfficeName(office.name);
  return effectiveSlug === slug;
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')?.trim();

  if (!slug) {
    return NextResponse.json({ error: 'Missing slug parameter' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Find office by slug
  const { data: offices, error: officesError } = await supabase
    .from('offices')
    .select('id, name, address, organization_id, settings')
    .eq('is_active', true);

  if (officesError) {
    return NextResponse.json({ error: officesError.message }, { status: 500 });
  }

  const office = offices?.find((entry: any) => matchesOfficePublicSlug(entry, slug));

  if (!office) {
    return NextResponse.json({ error: 'Office not found' }, { status: 404 });
  }

  // Fetch departments and active tickets in parallel
  const [deptsResult, ticketsResult] = await Promise.all([
    supabase
      .from('departments')
      .select('id, name, code, sort_order')
      .eq('office_id', office.id)
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('tickets')
      .select('id, department_id, status, priority, created_at, estimated_wait_minutes')
      .eq('office_id', office.id)
      .in('status', ['waiting', 'called', 'serving']),
  ]);

  if (deptsResult.error) {
    return NextResponse.json({ error: deptsResult.error.message }, { status: 500 });
  }

  const tickets = ticketsResult.data ?? [];
  const departments = deptsResult.data ?? [];

  // Build per-department stats
  const deptStats = departments.map((dept: any) => {
    const deptTickets = tickets.filter((t: any) => t.department_id === dept.id);
    const waiting = deptTickets.filter((t: any) => t.status === 'waiting').length;
    const called = deptTickets.filter((t: any) => t.status === 'called').length;
    const serving = deptTickets.filter((t: any) => t.status === 'serving').length;

    // Estimate wait: use average estimated_wait_minutes from waiting tickets, fallback to 5 min/ticket
    const waitingTickets = deptTickets.filter((t: any) => t.status === 'waiting');
    const estimatedWait =
      waitingTickets.length === 0
        ? 0
        : waitingTickets.reduce((sum: number, t: any) => sum + (t.estimated_wait_minutes ?? 5), 0);

    return {
      id: dept.id,
      name: dept.name,
      code: dept.code,
      sort_order: dept.sort_order,
      waiting,
      called,
      serving,
      estimatedWaitMinutes: estimatedWait,
    };
  });

  const totalWaiting = deptStats.reduce((sum, d) => sum + d.waiting, 0);
  const totalServing = deptStats.reduce((sum, d) => sum + d.serving, 0);

  return NextResponse.json({
    office: {
      id: office.id,
      name: office.name,
      address: office.address ?? null,
    },
    departments: deptStats,
    totalWaiting,
    totalServing,
  });
}
