/**
 * Web Speech API helpers for natural-voice ticket announcements on the
 * customer display. Shared between Station (for the "Test voice" button)
 * and the generated display HTML (see kiosk-server.ts).
 *
 * Why browser TTS?
 * - Free, offline-capable, zero external API dependency
 * - Modern Windows / macOS ship "Natural" Microsoft / Apple voices that
 *   sound genuinely human (en-US, en-GB, fr-FR, ar-SA, ar-EG, etc.)
 * - If the host OS lacks a good voice in the chosen language, we fall
 *   back gracefully through a priority chain rather than failing silently.
 *
 * Cloud TTS (OpenAI, ElevenLabs, Azure) is deliberately not used here —
 * it requires per-business API keys, costs money per utterance, and adds
 * latency. When the customer wants that upgrade, it slots in as a
 * drop-in replacement for `speakTicket()`.
 */

export type VoiceGender = 'female' | 'male';
export type VoiceLang = 'auto' | 'ar' | 'fr' | 'en';

export interface VoiceSettings {
  enabled: boolean;
  gender: VoiceGender;
  language: VoiceLang;
  /** 60-130 (stored as percentage). 100 = normal rate. */
  rate: number;
}

/** Read settings from an office_settings-like object with sensible defaults. */
export function parseVoiceSettings(source: Record<string, unknown> | null | undefined): VoiceSettings {
  const s = source ?? {};
  return {
    enabled: Boolean(s.voice_announcements),
    gender: (s.voice_gender === 'male' ? 'male' : 'female'),
    language: (['auto', 'ar', 'fr', 'en'].includes(String(s.voice_language ?? 'auto')) ? s.voice_language : 'auto') as VoiceLang,
    rate: typeof s.voice_rate === 'number' ? Math.max(60, Math.min(130, s.voice_rate)) : 90,
  };
}

// Heuristics used to guess whether an installed voice is male or female
// when the API doesn't expose gender. Works for common Windows / macOS /
// Chrome voice names (e.g. "Microsoft Hoda", "Google français", "Samantha").
const FEMALE_HINTS = [
  'female', 'woman', 'femme',
  'zira', 'hazel', 'susan', 'samantha', 'allison', 'ava', 'victoria', 'kate', 'serena', 'karen', 'moira', 'tessa', 'fiona',
  'hoda', 'naayf', 'amina', 'salma', 'mona',
  'amelie', 'aurélie', 'aurelie', 'audrey', 'marie', 'virginie', 'céline', 'celine',
  'nova', 'shimmer', 'alloy',
];
const MALE_HINTS = [
  'male', 'man', 'homme',
  'david', 'mark', 'george', 'alex', 'daniel', 'tom', 'fred', 'oliver', 'rishi',
  'naayf', 'maged', 'tarik', 'hamed',
  'thomas', 'henri', 'antoine', 'nicolas',
  'echo', 'fable', 'onyx', 'ash',
];

function guessGender(v: SpeechSynthesisVoice): VoiceGender | null {
  const n = v.name.toLowerCase();
  for (const h of FEMALE_HINTS) if (n.includes(h)) return 'female';
  for (const h of MALE_HINTS) if (n.includes(h)) return 'male';
  return null;
}

/** True for a voice flagged "Natural" / "Neural" / "Premium" by the OS. */
function isHighQuality(v: SpeechSynthesisVoice): boolean {
  const n = v.name.toLowerCase();
  return n.includes('natural') || n.includes('neural') || n.includes('premium') || n.includes('enhanced');
}

/**
 * Pick the best available voice for a language + gender. Falls back
 * gracefully if the exact combination isn't installed.
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: string,
  gender: VoiceGender,
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const langPrefix = lang.slice(0, 2).toLowerCase();
  const sameLang = voices.filter(v => v.lang.toLowerCase().startsWith(langPrefix));
  const pool = sameLang.length > 0 ? sameLang : voices;

  const genderMatches = pool.filter(v => guessGender(v) === gender);
  const candidates = genderMatches.length > 0 ? genderMatches : pool;

  // Prefer high-quality voices when available.
  const hq = candidates.find(isHighQuality);
  return hq ?? candidates[0] ?? null;
}

/** Wait for voices to load — Chrome/Edge populate them asynchronously. */
export async function getVoicesAsync(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const immediate = window.speechSynthesis.getVoices();
  if (immediate.length > 0) return immediate;
  return new Promise((resolve) => {
    const onReady = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', onReady);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', onReady);
    // Safety timeout — some browsers never fire voiceschanged.
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1500);
  });
}

function resolveLocale(settings: VoiceSettings, fallback: string): string {
  if (settings.language === 'auto') {
    const twoLetter = fallback.slice(0, 2).toLowerCase();
    if (twoLetter === 'ar') return 'ar-SA';
    if (twoLetter === 'fr') return 'fr-FR';
    return 'en-US';
  }
  return { ar: 'ar-SA', fr: 'fr-FR', en: 'en-US' }[settings.language];
}

/**
 * Speak a ticket announcement. `text` is the already-localized sentence
 * (e.g. "Ticket R-0079, please go to Salle"). The caller handles
 * translation so this file stays UI-agnostic.
 */
export async function speak(text: string, settings: VoiceSettings, fallbackLocale = 'en-US'): Promise<void> {
  if (!settings.enabled) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const voices = await getVoicesAsync();
  const lang = resolveLocale(settings, fallbackLocale);
  const voice = pickVoice(voices, lang, settings.gender);
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = Math.max(0.5, Math.min(1.5, settings.rate / 100));
  u.pitch = 1.0;
  u.volume = 1.0;
  if (voice) u.voice = voice;
  // Cancel anything currently queued so the new announcement is immediate.
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

/** Localized sample used by the "Test voice" button. */
export function buildSample(locale: string): string {
  const l = locale.slice(0, 2).toLowerCase();
  if (l === 'ar') return 'التذكرة رقم 79، توجه إلى المكتب رقم 1.';
  if (l === 'fr') return 'Ticket numéro 79, veuillez vous rendre au guichet numéro 1.';
  return 'Ticket number 79, please proceed to desk 1.';
}
