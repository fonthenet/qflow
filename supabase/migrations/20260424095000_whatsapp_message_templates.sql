-- Registry for WhatsApp Business approved message templates.
--
-- Outside the 24-hour customer service window, the Meta API only allows
-- pre-approved HSM (Highly Structured Messages) templates. This table
-- stores the approved template names, their locale variants, and which
-- org they belong to (or NULL for global/shared templates).
--
-- Approval workflow:
--   1. Tenant requests a template via the Qflo dashboard (future UI).
--   2. Qflo staff submits to Meta via the Business Manager.
--   3. Once approved, a row is inserted here with status='approved'.
--   4. The send layer picks the best template by (org_id, locale, purpose).

CREATE TABLE IF NOT EXISTS whatsapp_message_templates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL means global (shared across all orgs); set for per-tenant templates
  organization_id uuid        REFERENCES organizations(id) ON DELETE CASCADE,
  -- Purpose tag drives selection logic: 'queue_update' | 'appointment_reminder'
  -- | 'appointment_confirmed' | 'appointment_cancelled' | 'queue_joined'
  purpose         text        NOT NULL,
  -- BCP 47 locale code as used by Meta (e.g. 'fr', 'ar', 'en_US')
  locale          text        NOT NULL DEFAULT 'en',
  -- Exact template name as registered with Meta (case-sensitive)
  template_name   text        NOT NULL,
  -- Meta template language code (e.g. 'fr', 'ar', 'en_US')
  template_lang   text        NOT NULL DEFAULT 'en',
  -- 'pending_approval' | 'approved' | 'rejected' | 'paused'
  status          text        NOT NULL DEFAULT 'pending_approval'
                              CHECK (status IN ('pending_approval','approved','rejected','paused')),
  -- Optional: component structure for parameterised templates
  components      jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- One approved template per (org, purpose, locale). NULLs are excluded
  -- from uniqueness so global templates don't collide with org-specific ones.
  UNIQUE NULLS NOT DISTINCT (organization_id, purpose, locale)
);

CREATE INDEX IF NOT EXISTS idx_wa_templates_org_purpose
  ON whatsapp_message_templates (organization_id, purpose, locale)
  WHERE status = 'approved';

ALTER TABLE whatsapp_message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on whatsapp_message_templates"
  ON whatsapp_message_templates FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Org admins can view their own templates (plus global ones)
CREATE POLICY "Org admins can view their templates"
  ON whatsapp_message_templates FOR SELECT TO authenticated
  USING (
    organization_id IS NULL  -- global templates visible to all authenticated users
    OR organization_id IN (
      SELECT organization_id FROM staff
      WHERE auth_user_id = auth.uid() AND role IN ('owner','admin')
    )
  );

-- Seed: global fallback templates that ship with Qflo
-- These map to the env-var-driven fallback in whatsapp.ts.
-- Replace template_name values once approved in Meta Business Manager.
INSERT INTO whatsapp_message_templates
  (organization_id, purpose, locale, template_name, template_lang, status, components)
VALUES
  (NULL, 'queue_update', 'en', 'qflo_queue_update',      'en',    'pending_approval',
   '[{"type":"body","parameters":[{"type":"text","text":"{{1}}"}]}]'::jsonb),
  (NULL, 'queue_update', 'fr', 'qflo_queue_update_fr',   'fr',    'pending_approval',
   '[{"type":"body","parameters":[{"type":"text","text":"{{1}}"}]}]'::jsonb),
  (NULL, 'queue_update', 'ar', 'qflo_queue_update_ar',   'ar',    'pending_approval',
   '[{"type":"body","parameters":[{"type":"text","text":"{{1}}"}]}]'::jsonb)
ON CONFLICT DO NOTHING;
