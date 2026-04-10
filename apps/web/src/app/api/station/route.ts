import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOfficeDayStartIso } from '@/lib/office-day';
import { isValidTransition } from '@queueflow/shared';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

// GET /api/station?action=tickets&officeIds=...&statuses=...
// GET /api/station?action=config
// GET /api/station?action=session
// GET /api/station?action=query&table=...&officeIds=...
// GET /api/station?action=sync-status
// GET /api/station?action=settings
// GET /api/station?action=activity&officeId=...&limit=...
// GET /api/station?action=branding
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const url = new URL(req.url);
  const action = url.searchParams.get('action') ?? '';

  try {
    switch (action) {
      case 'session': {
        const { data: staff } = await supabase
          .from('staff')
          .select('id, full_name, role, office_id, organization_id')
          .eq('auth_user_id', user.id)
          .single();
        if (!staff) return json(null);

        // Get assigned desk
        const { data: desk } = await supabase
          .from('desks')
          .select('id, name, office_id')
          .eq('current_staff_id', staff.id)
          .eq('is_active', true)
          .single();

        return json({
          staff_id: staff.id,
          staff_name: staff.full_name,
          role: staff.role,
          office_id: staff.office_id,
          office_ids: [staff.office_id],
          organization_id: staff.organization_id,
          desk_id: desk?.id ?? null,
          desk_name: desk?.name ?? null,
        });
      }

      case 'config': {
        return json({ APP_VERSION: 'web', mode: 'remote' });
      }

      case 'tickets': {
        const officeIds = (url.searchParams.get('officeIds') ?? '').split(',').filter(Boolean);
        const statuses = (url.searchParams.get('statuses') ?? '').split(',').filter(Boolean);
        if (!officeIds.length) return json([]);

        const { data } = await supabase
          .from('tickets')
          .select('*')
          .in('office_id', officeIds)
          .in('status', statuses)
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .order('priority', { ascending: false })
          .order('created_at', { ascending: true });

        return json(data ?? []);
      }

      case 'query': {
        const table = url.searchParams.get('table') ?? '';
        const officeIds = (url.searchParams.get('officeIds') ?? '').split(',').filter(Boolean);
        if (!officeIds.length) return json([]);

        switch (table) {
          case 'departments': {
            const { data } = await supabase
              .from('departments')
              .select('id, name, code')
              .in('office_id', officeIds);
            return json(data ?? []);
          }
          case 'services': {
            const { data } = await supabase
              .from('services')
              .select('id, name, department_id');
            return json(data ?? []);
          }
          case 'desks': {
            const { data } = await supabase
              .from('desks')
              .select('id, name')
              .in('office_id', officeIds);
            return json(data ?? []);
          }
          default:
            return json([]);
        }
      }

      case 'sync-status': {
        return json({ isOnline: true, pendingCount: 0, lastSyncAt: new Date().toISOString() });
      }

      case 'settings': {
        return json({ locale: 'ar' });
      }

      case 'activity': {
        const officeId = url.searchParams.get('officeId');
        const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
        if (!officeId) return json([]);

        const { data } = await supabase
          .from('tickets')
          .select('id, ticket_number, status, customer_data, desk_id, called_at, served_at, completed_at, cancelled_at, created_at')
          .eq('office_id', officeId)
          .in('status', ['served', 'cancelled', 'no_show'])
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .order('completed_at', { ascending: false })
          .limit(limit);

        return json(data ?? []);
      }

      case 'kiosk-info': {
        const { data: staff2 } = await supabase
          .from('staff')
          .select('office_id')
          .eq('auth_user_id', user.id)
          .single();
        if (!staff2?.office_id) return json({ kioskUrl: null, displayUrl: null, stationUrl: null });

        const origin = req.headers.get('origin') || req.headers.get('host') || 'https://qflo.net';
        const base = origin.startsWith('http') ? origin : `https://${origin}`;
        const officeToken = staff2.office_id.replace(/-/g, '').slice(0, 16);

        return json({
          kioskUrl: `${base}/k/${officeToken}`,
          displayUrl: `${base}/d/${officeToken}`,
          stationUrl: `${base}/station`,
          localIP: null,
        });
      }

      case 'branding': {
        const { data: staff } = await supabase
          .from('staff')
          .select('office_id')
          .eq('auth_user_id', user.id)
          .single();
        if (!staff?.office_id) return json({ orgName: null, logoUrl: null });

        const { data: office } = await supabase
          .from('offices')
          .select('organization_id')
          .eq('id', staff.office_id)
          .single();
        if (!office?.organization_id) return json({ orgName: null, logoUrl: null });

        const { data: org } = await supabase
          .from('organizations')
          .select('name, logo_url, settings')
          .eq('id', office.organization_id)
          .single();

        return json({
          orgName: org?.name ?? null,
          logoUrl: org?.logo_url ?? null,
          brandColor: (org?.settings as Record<string, unknown>)?.brand_color ?? null,
        });
      }

      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[station-api]', action, message);
    return json({ error: message }, 500);
  }
}

// POST /api/station
// body: { action: 'update-ticket', ticketId, updates }
// body: { action: 'call-next', officeId, deskId, staffId }
// body: { action: 'create-ticket', ... }
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json();
  const action = body.action ?? '';

  try {
    switch (action) {
      case 'update-ticket': {
        const { ticketId, updates } = body;

        // Validate status transition if status is being changed
        if (updates?.status) {
          const { data: current, error: fetchErr } = await supabase
            .from('tickets')
            .select('status')
            .eq('id', ticketId)
            .single();
          if (fetchErr || !current) return json({ ok: false, error: 'Ticket not found' }, 404);
          if (!isValidTransition(current.status, updates.status)) {
            return json({ ok: false, error: `Invalid status transition: ${current.status} → ${updates.status}` }, 409);
          }
        }

        const { data, error } = await supabase
          .from('tickets')
          .update(updates)
          .eq('id', ticketId)
          .select()
          .single();
        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true, ticket: data });
      }

      case 'call-next': {
        const { officeId, deskId, staffId } = body;
        // Use RPC if available, otherwise manual query
        const { data: nextTicket } = await supabase
          .from('tickets')
          .select('*')
          .eq('office_id', officeId)
          .eq('status', 'waiting')
          .is('parked_at', null)
          .order('priority', { ascending: false })
          .order('created_at', { ascending: true })
          .limit(1)
          .single();

        if (!nextTicket) return json({ ok: false, error: 'No waiting tickets' });

        const { data, error } = await supabase
          .from('tickets')
          .update({
            status: 'called',
            desk_id: deskId,
            called_by_staff_id: staffId,
            called_at: new Date().toISOString(),
          })
          .eq('id', nextTicket.id)
          .select()
          .single();

        if (error) return json({ ok: false, error: error.message }, 400);
        return json({ ok: true, ticket: data });
      }

      case 'create-ticket': {
        const { data: staff } = await supabase
          .from('staff')
          .select('office_id')
          .eq('auth_user_id', user.id)
          .single();

        if (!staff) return json({ ok: false, error: 'No staff profile' }, 400);

        // Get department code for ticket prefix
        const { data: dept } = await supabase
          .from('departments')
          .select('code')
          .eq('id', body.departmentId)
          .single();
        const prefix = dept?.code || 'TKT';

        // Generate qr_token (12-char hex, same as desktop)
        const qrToken = crypto.randomUUID().replace(/-/g, '').slice(0, 12);

        // Try RPC first, then fallback with retry on duplicate
        let ticketNumber: string | null = null;
        const { data: seqResult } = await supabase.rpc('generate_daily_ticket_number', {
          p_department_id: body.departmentId,
        });
        const seq = Array.isArray(seqResult) ? seqResult[0] : seqResult;
        if (seq?.ticket_num) {
          ticketNumber = seq.ticket_num;
        }

        // Fetch office timezone for correct day boundary
        const { data: officeRow } = await supabase
          .from('offices')
          .select('timezone')
          .eq('id', body.officeId)
          .single();
        const todayStartIso = getOfficeDayStartIso(officeRow?.timezone);

        // Insert with retry (up to 5 attempts on duplicate key)
        let data = null;
        let lastError = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          if (!ticketNumber || attempt > 0) {
            // Fallback or retry: count existing + attempt offset
            const { count } = await supabase
              .from('tickets')
              .select('id', { count: 'exact', head: true })
              .eq('office_id', body.officeId)
              .gte('created_at', todayStartIso);
            ticketNumber = `${prefix}-${String((count ?? 0) + 1 + attempt).padStart(4, '0')}`;
          }

          const result = await supabase
            .from('tickets')
            .insert({
              ticket_number: ticketNumber,
              office_id: body.officeId,
              department_id: body.departmentId,
              service_id: body.serviceId || null,
              customer_data: {
                name: body.customerName || undefined,
                phone: body.customerPhone || undefined,
                reason: body.customerReason || undefined,
              },
              status: 'waiting',
              priority: body.priority || 1,
              source: body.source || 'in_house',
              qr_token: qrToken,
            })
            .select()
            .single();

          if (!result.error) {
            data = result.data;
            break;
          }
          lastError = result.error;
          // Only retry on duplicate key constraint
          if (!result.error.message.includes('unique constraint')) {
            return json({ ok: false, error: result.error.message }, 400);
          }
          ticketNumber = null; // Force fallback on next attempt
        }

        if (!data) return json({ ok: false, error: lastError?.message || 'Failed after retries' }, 400);
        // Return ticket directly (Station.tsx expects result.ticket_number)
        return json(data);
      }

      case 'logout': {
        await supabase.auth.signOut();
        return json({ ok: true });
      }

      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[station-api]', action, message);
    return json({ error: message }, 500);
  }
}
