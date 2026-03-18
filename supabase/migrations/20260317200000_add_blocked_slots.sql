-- Blocked slots: admin can manually block time ranges for specific dates
CREATE TABLE public.blocked_slots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  office_id uuid NOT NULL REFERENCES public.offices(id) ON DELETE CASCADE,
  blocked_date date NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  reason text,
  created_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_blocked_slots_office_date ON public.blocked_slots (office_id, blocked_date);

ALTER TABLE public.blocked_slots ENABLE ROW LEVEL SECURITY;

-- Staff can read blocked slots for their org's offices
CREATE POLICY "Staff can read blocked slots" ON public.blocked_slots
  FOR SELECT USING (
    office_id IN (
      SELECT o.id FROM public.offices o
      JOIN public.staff s ON s.organization_id = o.organization_id
      WHERE s.auth_user_id = auth.uid()
    )
  );

-- Admin/manager/branch_admin can insert blocked slots
CREATE POLICY "Admins can manage blocked slots" ON public.blocked_slots
  FOR INSERT WITH CHECK (
    office_id IN (
      SELECT o.id FROM public.offices o
      JOIN public.staff s ON s.organization_id = o.organization_id
      WHERE s.auth_user_id = auth.uid()
        AND s.role IN ('admin', 'manager', 'branch_admin')
    )
  );

-- Admin/manager/branch_admin can delete blocked slots
CREATE POLICY "Admins can delete blocked slots" ON public.blocked_slots
  FOR DELETE USING (
    office_id IN (
      SELECT o.id FROM public.offices o
      JOIN public.staff s ON s.organization_id = o.organization_id
      WHERE s.auth_user_id = auth.uid()
        AND s.role IN ('admin', 'manager', 'branch_admin')
    )
  );

-- Service role bypass for API routes
CREATE POLICY "Service role full access to blocked_slots" ON public.blocked_slots
  FOR ALL USING (auth.role() = 'service_role');
