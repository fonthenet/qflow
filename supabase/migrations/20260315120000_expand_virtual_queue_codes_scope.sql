ALTER TABLE virtual_queue_codes
ADD COLUMN organization_id uuid;

UPDATE virtual_queue_codes v
SET organization_id = o.organization_id
FROM offices o
WHERE o.id = v.office_id;

ALTER TABLE virtual_queue_codes
ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE virtual_queue_codes
ADD CONSTRAINT virtual_queue_codes_organization_id_fkey
FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE virtual_queue_codes
ALTER COLUMN office_id DROP NOT NULL;

ALTER TABLE virtual_queue_codes
ALTER COLUMN department_id DROP NOT NULL;

ALTER TABLE virtual_queue_codes
ADD CONSTRAINT virtual_queue_codes_scope_hierarchy_check
CHECK (
  (office_id IS NOT NULL OR department_id IS NULL)
  AND (department_id IS NOT NULL OR service_id IS NULL)
);

CREATE INDEX idx_virtual_queue_codes_org ON virtual_queue_codes(organization_id);

DROP POLICY IF EXISTS "Admin can manage virtual codes" ON virtual_queue_codes;

CREATE POLICY "Admin can manage virtual codes"
  ON virtual_queue_codes FOR ALL
  USING (organization_id = get_my_org_id())
  WITH CHECK (organization_id = get_my_org_id());
