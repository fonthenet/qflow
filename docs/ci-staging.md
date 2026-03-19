# Qflo CI and Staging Validation

## Workflows

- `Web CI`
  - runs on pull requests and pushes to `main`
  - installs dependencies
  - runs `pnpm --filter @queueflow/web test:platform`
  - runs `pnpm --filter @queueflow/web build`
  - optionally seeds the E2E tenant and runs smoke browser coverage when Supabase and E2E secrets are configured

- `Staging Validation`
  - manual workflow
  - seeds the dedicated E2E tenant
  - runs platform tests
  - runs a production build
  - runs the full Playwright suite with mutations enabled

## Required GitHub Secrets

Add these repository secrets before enabling the browser validation path:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
QUEUEFLOW_E2E_EMAIL=
QUEUEFLOW_E2E_PASSWORD=
```

Recommended:
- use a dedicated Supabase test tenant, not production
- use a dedicated admin test account only for automated validation

## Expected E2E Tenant Defaults

The workflows seed a reusable tenant with:

```env
QUEUEFLOW_E2E_ORG_NAME=Qflo E2E
QUEUEFLOW_E2E_ORG_SLUG=queueflow-e2e
QUEUEFLOW_E2E_OFFICE_NAME=E2E Main Branch
QUEUEFLOW_E2E_BRANCH_TYPE=branch_office
QUEUEFLOW_E2E_OPERATING_MODEL=service_routing
QUEUEFLOW_E2E_ASSIGN_ADMIN_OFFICE=true
QUEUEFLOW_E2E_ASSIGN_ADMIN_DESK=false
```

The staging workflow lets you switch `QUEUEFLOW_E2E_TEMPLATE_ID` at dispatch time so you can validate different verticals without changing the repo.

## Suggested Release Flow

1. Open a PR and let `Web CI` pass.
2. Merge to `main`.
3. Run `Staging Validation` for the target template or vertical.
4. Review Playwright artifacts if a failure occurs.
5. Deploy only after staging validation is green.
