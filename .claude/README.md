# Qflo Virtual Team

This directory contains the Qflo virtual engineering team — specialized subagents and slash-command skills used to execute the global build plan across Africa/MENA (primary) and US/EU/Asia (secondary).

## Usage

- **Subagents** (`.claude/agents/*.md`) are delegated to automatically by Claude when a task matches their `description`, or can be explicitly invoked via the Task tool. Each runs in its own context window.
- **Skills** (`.claude/skills/<name>/SKILL.md`) are user-invoked via `/<name>` (or by Claude for non-disable-model-invocation skills). Most are slash-command playbooks; some delegate to a subagent via `context: fork`.

## Subagents (19)

### Engineering
- **qflo-architect** (opus) — plans multi-step implementations; never writes code.
- **qflo-web-engineer** — Next.js 15 / React 19 / Supabase in `apps/web`.
- **qflo-station-engineer** — Electron + SQLite in `apps/desktop`.
- **qflo-mobile-engineer** — Expo / React Native in `apps/mobile`.
- **qflo-migration-writer** — Supabase SQL migrations + RLS; applies via MCP.
- **qflo-channel-adapter-engineer** — WhatsApp, Messenger, future LINE/KakaoTalk/Zalo.
- **qflo-payment-integrator** — Stripe, CIB/Edahabia, CMI, Mada, Razorpay, M-Pesa, etc. behind one interface.
- **qflo-integrations-engineer** — Google Reserve, Zapier, POS, QuickBooks, calendar sync.
- **qflo-i18n-specialist** (haiku) — translation packs, RTL, locale formatters.
- **qflo-data-engineer** (opus) — analytics, dashboards, no-show prediction.

### Quality + cross-cutting
- **qflo-qa-engineer** — vitest + typecheck + browser verification via preview_* tools.
- **qflo-security-reviewer** (opus) — read-only audits before release.
- **qflo-compliance-officer** — GDPR, SOC 2, DPDP, CCPA, VAT formats.
- **qflo-accessibility-auditor** — WCAG 2.1 AA, kiosk ADA risk, EU Accessibility Act.
- **qflo-performance-engineer** — bundle size, SQLite tuning, low-bandwidth mode.
- **qflo-devops-engineer** — CI/CD, Vercel, GitHub Releases, Supabase backups, Sentry.

### Orchestration + GTM
- **qflo-country-launcher** (opus) — orchestrates full country launch checklist in parallel.
- **qflo-market-researcher** — competitive intel, pricing benchmarks, market sizing.
- **qflo-marketing-writer** — landing pages, case studies, SEO, help docs per region.

## Skills (12)

### Product workflows
- **/add-country `<ISO>`** — full country launch via qflo-country-launcher.
- **/add-locale `<lang>`** — seed translation pack via qflo-i18n-specialist.
- **/add-vertical `<slug>`** — vertical overlay (clinic, salon, pharmacy, etc.).
- **/add-integration `<provider>`** — scaffold third-party integration.

### Release workflows
- **/ship-station** — fast iteration: bump → kill → build:dir → relaunch.
- **/release-station** — full NSIS installer release with audit.
- **/deploy-web** — push to main respecting batch-deploy rule.
- **/new-migration `<slug>`** — SQL migration + apply + types + advisors.

### Quality gates
- **/pre-release-audit** — security + QA + compliance + a11y + perf in parallel.
- **/a11y-audit `[surface]`** — WCAG 2.1 AA check.
- **/supabase-backup-check** — monthly health + quarterly restore drill.
- **/competitor-check `<region>`** — market intel refresh.

## Architectural invariants every agent follows

1. **Country-agnostic core** — shared plan; features overlay via `org.country` config, never branches in core code.
2. **Vertical-agnostic core** — one data model; labels and optional modules overlay via `org.vertical`.
3. **Channel adapter interface** — new channels plug in; booking/queue logic is channel-agnostic.
4. **Locale ≠ country** — Arabic-in-France user gets AR UI + EUR pricing.
5. **Offline-first for Station** — SQLite + ensureAuth(); works without Supabase.
6. **IPC safety** — never object-pass `organization_id` through Electron IPC.
7. **SQLite migration dual-write** — initial schema AND `CREATE TABLE IF NOT EXISTS` section.
8. **Meta webhook dedup** — every state-changing handler idempotent.
9. **Currency** — 2 decimals always; DZD centimes never stripped.
10. **Customer locale** — WhatsApp/receipt/push follows ticket.locale, not operator.

## Scope constraints

- **No SMS channel** (directive).
- **No Mac build** (directive).
- **Brand is "Qflo"** in user-facing copy; "qflow" = repo name only.

## Adding to the team

Create a new agent: drop a new `.md` file in `.claude/agents/` with frontmatter (`name`, `description`, `tools`, optional `model`).

Create a new skill: make a directory `.claude/skills/<name>/` with a `SKILL.md`.

See https://code.claude.com/docs/en/sub-agents and https://code.claude.com/docs/en/skills for the full format.
