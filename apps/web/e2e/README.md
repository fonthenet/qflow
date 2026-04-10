# QueueFlow Admin E2E

These Playwright tests cover authenticated admin routes using a real browser and a running Next.js server.

Safe default:
- `admin-smoke.spec.ts` is read-only and intended for a dedicated admin test account.
- `public-smoke.spec.ts` is read-only and covers kiosk, booking, and display routes against seeded data.

Opt-in mutations:
- `admin-mutations.spec.ts` submits onboarding and governance actions.
- `operator-public-mutations.spec.ts` covers kiosk-to-desk handling and appointment booking submission.
- Only run it against a dedicated test tenant.

Required environment variables:
```env
QUEUEFLOW_E2E_EMAIL=admin@example.com
QUEUEFLOW_E2E_PASSWORD=secret-password
```

Optional environment variables:
```env
QUEUEFLOW_E2E_BASE_URL=http://127.0.0.1:3100
QUEUEFLOW_E2E_ALLOW_MUTATIONS=true
```

Commands:
```bash
pnpm --filter @qflo/web e2e:seed
pnpm --filter @qflo/web e2e:reset
pnpm --filter @qflo/web test:e2e:list
pnpm --filter @qflo/web test:e2e:smoke
pnpm --filter @qflo/web test:e2e:mutations
pnpm --filter @qflo/web test:e2e
```

Seeding environment:
```env
SUPABASE_SERVICE_ROLE_KEY=...
QUEUEFLOW_E2E_EMAIL=admin@example.com
QUEUEFLOW_E2E_PASSWORD=secret-password
QUEUEFLOW_E2E_ORG_NAME=QueueFlow E2E
QUEUEFLOW_E2E_TEMPLATE_ID=bank-branch
QUEUEFLOW_E2E_BRANCH_TYPE=branch_office
QUEUEFLOW_E2E_OPERATING_MODEL=service_routing
QUEUEFLOW_E2E_OFFICE_NAME=E2E Main Branch
QUEUEFLOW_E2E_ASSIGN_ADMIN_OFFICE=true
QUEUEFLOW_E2E_ASSIGN_ADMIN_DESK=false
```

Seed output:
- `e2e:seed` writes `apps/web/.e2e-state.json` with the seeded office slug and display screen tokens.
- Public smoke tests use that file automatically, so you do not need to hand-copy tokens into env vars.

CI and staging:
- `.github/workflows/web-ci.yml` runs build and platform validation, plus smoke browser coverage when secrets are configured.
- `.github/workflows/staging-validation.yml` runs the full seeded browser suite with mutations enabled.
- Setup details are documented in [docs/ci-staging.md](/c:/Users/Faycel/Documents/Ticket/qflow/docs/ci-staging.md).

Optional reset flags:
```env
QUEUEFLOW_E2E_DROP_ORG=false
QUEUEFLOW_E2E_DROP_USER=false
```
