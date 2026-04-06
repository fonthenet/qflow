'use server';

import { getStaffContext } from '@/lib/authz';

export async function getBroadcastTemplates() {
  const context = await getStaffContext();
  const { data, error } = await (context.supabase as any)
    .from('broadcast_templates')
    .select('*')
    .eq('organization_id', context.staff.organization_id)
    .order('created_at', { ascending: false });

  if (error) return { error: error.message, templates: [] };
  return { templates: data ?? [] };
}

export async function saveBroadcastTemplate(template: {
  id?: string;
  title: string;
  body_fr?: string;
  body_ar?: string;
  body_en?: string;
}) {
  const context = await getStaffContext();

  if (template.id) {
    // Update existing template
    const { error } = await (context.supabase as any)
      .from('broadcast_templates')
      .update({
        title: template.title,
        body_fr: template.body_fr,
        body_ar: template.body_ar,
        body_en: template.body_en,
        updated_at: new Date().toISOString(),
      })
      .eq('id', template.id)
      .eq('organization_id', context.staff.organization_id);

    if (error) return { error: error.message };
  } else {
    // Insert new template
    const { error } = await (context.supabase as any)
      .from('broadcast_templates')
      .insert({
        organization_id: context.staff.organization_id,
        title: template.title,
        body_fr: template.body_fr,
        body_ar: template.body_ar,
        body_en: template.body_en,
      });

    if (error) return { error: error.message };
  }

  return { success: true };
}

export async function deleteBroadcastTemplate(id: string) {
  const context = await getStaffContext();
  const { error } = await (context.supabase as any)
    .from('broadcast_templates')
    .delete()
    .eq('id', id)
    .eq('organization_id', context.staff.organization_id);

  if (error) return { error: error.message };
  return { success: true };
}

export async function sendBroadcast(data: {
  message: string;
  officeId?: string;
  templateId?: string;
}) {
  const context = await getStaffContext();

  // Call the broadcast API route internally
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  const res = await fetch(`${baseUrl}/api/broadcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-org-id': context.staff.organization_id,
      'x-user-id': context.userId,
    },
    body: JSON.stringify({
      organizationId: context.staff.organization_id,
      officeId: data.officeId,
      message: data.message,
      templateId: data.templateId,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(60000),
  });

  const result = await res.json();
  return result;
}
