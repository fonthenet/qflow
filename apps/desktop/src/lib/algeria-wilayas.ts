// Thin re-export shim — the canonical data lives in @qflo/shared.
// Keep this file so existing desktop imports continue to work.
export {
  ALGERIA_WILAYAS,
  BLOOD_TYPES,
  GENDERS,
  getWilayaByCode,
  getCommunes,
} from '@qflo/shared';
export type { Wilaya } from '@qflo/shared';
