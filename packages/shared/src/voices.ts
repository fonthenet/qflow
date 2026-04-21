/**
 * Shared voice catalog for Qflo Station + web portal.
 *
 * Voice IDs are Microsoft Edge neural voice short-names — the ones served
 * via Edge's "Read Aloud" API (free) and by paid Azure Neural TTS. The
 * Station generates MP3s from these via Python `edge-tts`; the portal
 * displays the same catalog so admins see the same options everywhere.
 *
 * Focus is Arabic (Algerian accent first, Saudi MSA as alternative) and
 * French (Vivienne / Rémy multilingual as default, Denise / Henri as
 * classics). English is included as a third option.
 */

export type VoiceLanguage = 'ar' | 'fr' | 'en';
export type VoiceGender = 'female' | 'male';

export interface VoiceOption {
  /** Edge TTS short-name passed to edge-tts. Stable identifier. */
  id: string;
  /** Human-friendly name shown in settings UI. */
  displayName: string;
  language: VoiceLanguage;
  /** BCP-47 locale, e.g. 'fr-FR', 'ar-DZ'. */
  locale: string;
  gender: VoiceGender;
  /** i18n key suffix for the description (e.g. 'algerian_warm' →
   * 'sm.voice_desc.algerian_warm'). Consumers translate via their own
   * i18n dict so the label reads in the operator's UI language. */
  descriptionKey: string;
  /** English fallback for the description, used as the default and when
   * an i18n lookup misses. */
  description: string;
  /** Recommended default for its (language, gender) pair. */
  isDefault?: boolean;
}

export const VOICE_CATALOG: VoiceOption[] = [
  // ── Arabic ──────────────────────────────────────────────────────
  {
    id: 'ar-DZ-AminaNeural',
    displayName: 'Amina',
    language: 'ar',
    locale: 'ar-DZ',
    gender: 'female',
    descriptionKey: 'algerian_warm',
    description: 'Algerian accent — warm',
    isDefault: true,
  },
  {
    id: 'ar-DZ-IsmaelNeural',
    displayName: 'Ismaël',
    language: 'ar',
    locale: 'ar-DZ',
    gender: 'male',
    descriptionKey: 'algerian_calm',
    description: 'Algerian accent — calm',
    isDefault: true,
  },
  {
    id: 'ar-SA-ZariyahNeural',
    displayName: 'Zariyah',
    language: 'ar',
    locale: 'ar-SA',
    gender: 'female',
    descriptionKey: 'msa',
    description: 'Modern Standard Arabic',
  },
  {
    id: 'ar-SA-HamedNeural',
    displayName: 'Hamed',
    language: 'ar',
    locale: 'ar-SA',
    gender: 'male',
    descriptionKey: 'msa',
    description: 'Modern Standard Arabic',
  },
  // ── French ──────────────────────────────────────────────────────
  {
    id: 'fr-FR-VivienneMultilingualNeural',
    displayName: 'Vivienne',
    language: 'fr',
    locale: 'fr-FR',
    gender: 'female',
    descriptionKey: 'fr_multilingual',
    description: 'Warm, multilingual — most natural',
    isDefault: true,
  },
  {
    id: 'fr-FR-RemyMultilingualNeural',
    displayName: 'Rémy',
    language: 'fr',
    locale: 'fr-FR',
    gender: 'male',
    descriptionKey: 'fr_multilingual',
    description: 'Warm, multilingual — most natural',
    isDefault: true,
  },
  {
    id: 'fr-FR-DeniseNeural',
    displayName: 'Denise',
    language: 'fr',
    locale: 'fr-FR',
    gender: 'female',
    descriptionKey: 'fr_classic',
    description: 'Classic broadcast-quality',
  },
  {
    id: 'fr-FR-HenriNeural',
    displayName: 'Henri',
    language: 'fr',
    locale: 'fr-FR',
    gender: 'male',
    descriptionKey: 'fr_classic',
    description: 'Classic broadcast-quality',
  },
  {
    id: 'fr-FR-EloiseNeural',
    displayName: 'Éloïse',
    language: 'fr',
    locale: 'fr-FR',
    gender: 'female',
    descriptionKey: 'fr_young',
    description: 'Youthful, bright',
  },
  {
    id: 'fr-FR-YvetteNeural',
    displayName: 'Yvette',
    language: 'fr',
    locale: 'fr-FR',
    gender: 'female',
    descriptionKey: 'fr_mature',
    description: 'Mature, professional',
  },
  {
    id: 'fr-FR-JeromeNeural',
    displayName: 'Jérôme',
    language: 'fr',
    locale: 'fr-FR',
    gender: 'male',
    descriptionKey: 'fr_professional',
    description: 'Professional, clear',
  },
  {
    id: 'fr-FR-AlainNeural',
    displayName: 'Alain',
    language: 'fr',
    locale: 'fr-FR',
    gender: 'male',
    descriptionKey: 'fr_warm',
    description: 'Warm, mature',
  },

  // ── English ─────────────────────────────────────────────────────
  {
    id: 'en-US-AriaNeural',
    displayName: 'Aria',
    language: 'en',
    locale: 'en-US',
    gender: 'female',
    descriptionKey: 'en_us',
    description: 'American English',
    isDefault: true,
  },
  {
    id: 'en-US-GuyNeural',
    displayName: 'Guy',
    language: 'en',
    locale: 'en-US',
    gender: 'male',
    descriptionKey: 'en_us',
    description: 'American English',
    isDefault: true,
  },
];

/** Look up a voice by id. Returns undefined for unknown ids. */
export function getVoice(id: string): VoiceOption | undefined {
  return VOICE_CATALOG.find((v) => v.id === id);
}

/**
 * Resolve the best voice id given (optional explicit id, language, gender).
 * Explicit id wins. Otherwise picks the catalog default for the pair.
 */
export function resolveVoiceId(
  explicitId: string | null | undefined,
  language: VoiceLanguage | string,
  gender: VoiceGender | string,
): string {
  if (explicitId) {
    const v = getVoice(explicitId);
    if (v) return v.id;
  }
  const lang = (String(language || 'en').slice(0, 2).toLowerCase()) as VoiceLanguage;
  const g: VoiceGender = gender === 'male' ? 'male' : 'female';
  const forPair = VOICE_CATALOG.filter((v) => v.language === lang && v.gender === g);
  return (forPair.find((v) => v.isDefault) ?? forPair[0] ?? VOICE_CATALOG[0]).id;
}

/** Catalog entries grouped by language, for settings UIs. */
export function voicesByLanguage(): Record<VoiceLanguage, VoiceOption[]> {
  return VOICE_CATALOG.reduce(
    (acc, v) => {
      (acc[v.language] ??= []).push(v);
      return acc;
    },
    { ar: [] as VoiceOption[], fr: [] as VoiceOption[], en: [] as VoiceOption[] },
  );
}
