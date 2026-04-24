/**
 * @deprecated Import from `@qflo/shared` directly.
 *
 * Thin re-export kept for backwards compatibility while call sites migrate.
 * The canonical definition (with per-category setup-wizard defaults) lives
 * in `packages/shared/src/setup-wizard/categories.ts`.
 */

export type { BusinessCategory, CategoryDefinition } from '@qflo/shared';
export { BUSINESS_CATEGORIES, getBusinessCategory, resolveLocalized } from '@qflo/shared';
