import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth-context';

interface OrgContext {
  orgId: string | null;
  orgName: string;
  officeIds: string[];
  staffId: string | null;
  staffRole: string | null;
  loading: boolean;
}

export function useOrg(): OrgContext {
  const { user } = useAuth();
  const [ctx, setCtx] = useState<OrgContext>({
    orgId: null, orgName: '', officeIds: [], staffId: null, staffRole: null, loading: true,
  });

  useEffect(() => {
    if (!user) {
      setCtx(c => ({ ...c, loading: false }));
      return;
    }

    const load = async () => {
      const { data: staff } = await supabase
        .from('staff')
        .select('id, organization_id, role, organizations:organization_id(name)')
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (!staff) {
        setCtx(c => ({ ...c, loading: false }));
        return;
      }

      const orgId = staff.organization_id;
      const orgName = (staff as any).organizations?.name ?? '';

      const { data: offices } = await supabase
        .from('offices')
        .select('id')
        .eq('organization_id', orgId);

      setCtx({
        orgId,
        orgName,
        officeIds: offices?.map(o => o.id) ?? [],
        staffId: staff.id,
        staffRole: staff.role,
        loading: false,
      });
    };

    load();
  }, [user]);

  return ctx;
}
