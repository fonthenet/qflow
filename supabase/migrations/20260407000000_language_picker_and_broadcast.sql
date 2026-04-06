-- Add 'pending_language' session state, last_notified_position column,
-- and broadcast_templates / broadcast_logs tables for the language-picker
-- and broadcast messaging features.

-- ============================================
-- 1. Extend whatsapp_sessions state constraint
-- ============================================
ALTER TABLE whatsapp_sessions
  DROP CONSTRAINT whatsapp_session_state,
  ADD CONSTRAINT whatsapp_session_state
    CHECK (state IN (
      'awaiting_join', 'active', 'completed',
      'pending_confirmation', 'pending_department',
      'pending_service', 'pending_language'
    ));

-- ============================================
-- 2. Add last_notified_position column
-- ============================================
ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS last_notified_position integer DEFAULT NULL;

-- ============================================
-- 3. Create broadcast_templates table
-- ============================================
CREATE TABLE IF NOT EXISTS broadcast_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  body_fr text,
  body_ar text,
  body_en text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_broadcast_templates_org ON broadcast_templates(organization_id);

ALTER TABLE broadcast_templates ENABLE ROW LEVEL SECURITY;

-- Org members can read their own templates
CREATE POLICY "Staff can view broadcast templates"
  ON broadcast_templates FOR SELECT
  USING (organization_id = get_my_org_id());

-- Org members can manage (insert/update/delete) their own templates
CREATE POLICY "Staff can manage broadcast templates"
  ON broadcast_templates FOR ALL
  USING (organization_id = get_my_org_id())
  WITH CHECK (organization_id = get_my_org_id());

-- Service role has full access (edge functions, triggers, etc.)
CREATE POLICY "Service role full access to broadcast templates"
  ON broadcast_templates FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- 4. Create broadcast_logs table
-- ============================================
CREATE TABLE IF NOT EXISTS broadcast_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  office_id uuid REFERENCES offices(id),
  sent_by uuid REFERENCES auth.users(id),
  message text NOT NULL,
  template_id uuid REFERENCES broadcast_templates(id),
  recipients_count integer DEFAULT 0,
  channel text DEFAULT 'all',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_broadcast_logs_org ON broadcast_logs(organization_id);

ALTER TABLE broadcast_logs ENABLE ROW LEVEL SECURITY;

-- Org members can view broadcast logs
CREATE POLICY "Staff can view broadcast logs"
  ON broadcast_logs FOR SELECT
  USING (organization_id = get_my_org_id());

-- Org members can manage broadcast logs
CREATE POLICY "Staff can manage broadcast logs"
  ON broadcast_logs FOR ALL
  USING (organization_id = get_my_org_id())
  WITH CHECK (organization_id = get_my_org_id());

-- Service role has full access
CREATE POLICY "Service role full access to broadcast logs"
  ON broadcast_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
