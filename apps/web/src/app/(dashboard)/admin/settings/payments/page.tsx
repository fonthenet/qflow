import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { CashToggleForm } from './cash-toggle-form';

export const metadata = { title: 'Payment Methods — Qflo' };

async function setAcceptsCash(orgId: string, accepts: boolean): Promise<void> {
  'use server';
  const context = await getStaffContext();
  await requireOrganizationAdmin(context);

  const supabase = createAdminClient() as any;
  await supabase
    .from('organizations')
    .update({ accepts_cash: accepts })
    .eq('id', orgId);

  revalidatePath('/admin/settings/payments');
}

export default async function PaymentsSettingsPage() {
  const context = await getStaffContext();
  try {
    await requireOrganizationAdmin(context);
  } catch {
    redirect('/admin/settings');
  }

  const orgId = context.staff.organization_id;
  const supabase = createAdminClient() as any;
  const { data: org } = await supabase
    .from('organizations')
    .select('accepts_cash')
    .eq('id', orgId)
    .single();

  const acceptsCash: boolean = org?.accepts_cash ?? false;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Payment Methods</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Qflo doesn&apos;t handle payments. If you accept cash at your counter,
          flip this on and we&apos;ll mention it on the customer&apos;s ticket page.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card p-6">
        <CashToggleForm orgId={orgId} acceptsCash={acceptsCash} setAcceptsCash={setAcceptsCash} />
      </div>
    </div>
  );
}
