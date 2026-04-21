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
  /** Explicit Edge voice id (e.g. 'fr-FR-VivienneMultilingualNeural').
   *  When set, overrides gender+language. */
  voiceId?: string | null;
  /** Target audio output device id (from navigator.mediaDevices). Empty
   *  string or null means "use Windows default device" — which routes
   *  through the main-process sound-play path. */
  outputDeviceId?: string | null;
  /** Whether to play the chime before the voice. */
  chimeEnabled?: boolean;
}

/** Read settings from an office_settings-like object with sensible defaults. */
export function parseVoiceSettings(source: Record<string, unknown> | null | undefined): VoiceSettings {
  const s = source ?? {};
  return {
    // Voice announcements default ON — every new org should hear the
    // ticket call without needing to opt in. Admins can still disable
    // explicitly in Settings (stored as `voice_announcements: false`).
    enabled: s.voice_announcements !== false,
    gender: (s.voice_gender === 'male' ? 'male' : 'female'),
    language: (['auto', 'ar', 'fr', 'en'].includes(String(s.voice_language ?? 'auto')) ? s.voice_language : 'auto') as VoiceLang,
    rate: typeof s.voice_rate === 'number' ? Math.max(60, Math.min(130, s.voice_rate)) : 90,
    // Denise — French female, broadcast-quality — is the platform-wide
    // default. Applies when org settings don't carry an explicit voice_id.
    voiceId: typeof s.voice_id === 'string' && s.voice_id ? s.voice_id : 'fr-FR-DeniseNeural',
    outputDeviceId: typeof s.voice_output_device_id === 'string' && s.voice_output_device_id
      ? s.voice_output_device_id
      : null,
    // Default true — existing businesses have always heard the chime.
    chimeEnabled: s.announcement_sound_enabled !== false,
  };
}

/**
 * List the OS audio output devices visible to the Station renderer.
 * Used by the Settings UI to populate the "Audio output" dropdown.
 *
 * Requires microphone permission to retrieve device *labels* (Chrome
 * privacy policy). The Station's preload grants this permission
 * automatically via a one-time silent `getUserMedia({ audio: true })`.
 * Falls back to label-less device ids if permission hasn't been
 * granted yet — the user can still pick by index, just without names.
 */
export async function listAudioOutputs(): Promise<Array<{ deviceId: string; label: string }>> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    // Trigger a silent mic request so `label` is populated. Immediately
    // stop the stream — we don't need the input, just the device labels.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch { /* permission denied — continue with unlabeled devices */ }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audiooutput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label || `Audio output ${d.deviceId.slice(0, 6)}` }));
  } catch {
    return [];
  }
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
  // Explicit voice_id wins: picking 'ar-DZ-AminaNeural' implies Arabic
  // text, otherwise the Arabic voice would read English words.
  if (settings.voiceId) {
    const p = settings.voiceId.slice(0, 2).toLowerCase();
    if (p === 'ar') return 'ar-SA';
    if (p === 'fr') return 'fr-FR';
    if (p === 'en') return 'en-US';
  }
  if (settings.language === 'auto') {
    const twoLetter = fallback.slice(0, 2).toLowerCase();
    if (twoLetter === 'ar') return 'ar-SA';
    if (twoLetter === 'fr') return 'fr-FR';
    return 'en-US';
  }
  return { ar: 'ar-SA', fr: 'fr-FR', en: 'en-US' }[settings.language];
}

/** Which path the last speak() call actually used. */
export type SpeakResult = {
  path: 'kiosk-server' | 'browser' | 'failed';
  voice: string;
  reason?: string;
};

async function speakViaKioskServer(text: string, lang: string, settings: VoiceSettings): Promise<SpeakResult> {
  // Create the <audio> element synchronously inside the user gesture so
  // Electron/Chromium's autoplay policy grants play() permission even if
  // the fetch below takes a moment to resolve.
  const audio = new Audio();
  audio.preload = 'auto';

  let port: number;
  try {
    const qf = (window as any).qf;
    port = await (qf?.getKioskPort?.() ?? Promise.resolve(8080));
    if (!port) return { path: 'failed', voice: '', reason: 'no port' };
  } catch (e: any) {
    return { path: 'failed', voice: '', reason: `port: ${e?.message ?? e}` };
  }

  const langShort = lang.slice(0, 2).toLowerCase();
  const url = `http://127.0.0.1:${port}/api/tts`
    + `?text=${encodeURIComponent(text)}`
    + `&language=${encodeURIComponent(langShort)}`
    + `&gender=${encodeURIComponent(settings.gender)}`
    + `&rate=${encodeURIComponent(settings.rate)}`
    + (settings.voiceId ? `&voice=${encodeURIComponent(settings.voiceId)}` : '');

  // Pointing <audio>.src directly at the kiosk-server URL (instead of a
  // blob URL) keeps the playback request in the same tick — no await
  // between the user click and audio.play(), so autoplay stays granted.
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { path: 'failed', voice: '', reason: `HTTP ${res.status} ${body.slice(0, 120)}` };
    }
    const blob = await res.blob();
    if (!blob.type.startsWith('audio')) {
      return { path: 'failed', voice: '', reason: `non-audio ${blob.type}` };
    }
    audio.src = URL.createObjectURL(blob);
    await audio.play();
    // Which voice the server chose — matches the catalog in electron/tts-cache.ts.
    const voiceName = {
      fr: { female: 'Vivienne (FR)', male: 'Remy (FR)' },
      ar: { female: 'Amina (DZ)', male: 'Ismael (DZ)' },
      en: { female: 'Aria (EN)', male: 'Guy (EN)' },
    }[langShort as 'fr' | 'ar' | 'en']?.[settings.gender] ?? `${langShort}/${settings.gender}`;
    return { path: 'kiosk-server', voice: voiceName };
  } catch (e: any) {
    return { path: 'failed', voice: '', reason: `play: ${e?.message ?? e}` };
  }
}

/**
 * Route audio to a specific OS output device. The main process supplies
 * the chime + voice bytes via IPC; we wrap them in Blobs and play
 * through HTMLAudioElements whose `sinkId` is pinned to the selected
 * device. This is the only way to hit a non-default Windows sink from
 * inside the Electron sandbox.
 *
 * Why chained audio elements instead of one-shot MediaStream: we want
 * the chime to finish before the voice starts (same UX as the main
 * process path). `audio.onended` gives us that without any timing
 * estimates getting cut off on long custom chimes.
 */
async function speakViaDevice(
  text: string,
  lang: string,
  settings: VoiceSettings,
): Promise<SpeakResult> {
  const api = (window as any).qf?.voice?.getAnnouncementAudio;
  if (!api) return { path: 'failed', voice: '', reason: 'preload missing voice.getAnnouncementAudio' };
  const deviceId = settings.outputDeviceId ?? '';
  if (!deviceId) return { path: 'failed', voice: '', reason: 'no device id' };

  let chimeUrl: string | null = null;
  let speechUrl: string | null = null;
  try {
    const res = await api({
      text,
      language: lang.slice(0, 2).toLowerCase(),
      gender: settings.gender,
      rate: settings.rate,
      voiceId: settings.voiceId ?? null,
      includeChime: settings.chimeEnabled !== false,
    });
    if (!res?.ok) return { path: 'failed', voice: res?.voice ?? '', reason: res?.error ?? 'no audio bytes' };

    if (res.chime?.buffer) {
      chimeUrl = URL.createObjectURL(new Blob([res.chime.buffer], { type: res.chime.mime }));
    }
    if (res.speech?.buffer) {
      speechUrl = URL.createObjectURL(new Blob([res.speech.buffer], { type: res.speech.mime }));
    } else {
      return { path: 'failed', voice: res.voice ?? '', reason: 'missing speech audio' };
    }

    const playWithSink = async (url: string) => {
      const audio = new Audio(url);
      // `setSinkId` isn't in every TS lib version — use a cast.
      const setSink = (audio as any).setSinkId;
      if (typeof setSink === 'function') {
        try { await (audio as any).setSinkId(deviceId); }
        catch (err: any) { throw new Error(`setSinkId failed: ${err?.message ?? err}`); }
      } else {
        throw new Error('setSinkId unavailable in this Chromium build');
      }
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error(`audio error: ${audio.error?.message ?? 'unknown'}`));
        audio.play().catch(reject);
      });
    };

    if (chimeUrl) {
      try { await playWithSink(chimeUrl); }
      catch (err: any) { /* chime failure is non-fatal; continue to voice */
        console.warn('[voice] chime via device failed', err?.message);
      }
    }
    await playWithSink(speechUrl);

    return { path: 'kiosk-server', voice: res.voice ?? settings.voiceId ?? '' };
  } catch (err: any) {
    return { path: 'failed', voice: '', reason: `device-routed: ${err?.message ?? err}` };
  } finally {
    if (chimeUrl) URL.revokeObjectURL(chimeUrl);
    if (speechUrl) URL.revokeObjectURL(speechUrl);
  }
}

async function speakViaMainProcess(text: string, lang: string, settings: VoiceSettings): Promise<SpeakResult> {
  // Main-process playback: Electron main spawns Python edge-tts, caches
  // the MP3, and plays it through the OS audio stack (sound-play ->
  // PowerShell MediaPlayer on Windows). No browser involvement — no CSP,
  // no autoplay gesture, no tab reload. This is the commercial-grade path.
  const api = (window as any).qf?.voice?.announce;
  if (!api) return { path: 'failed', voice: '', reason: 'preload missing voice.announce' };
  try {
    const res = await api({
      text,
      language: lang.slice(0, 2).toLowerCase(),
      gender: settings.gender,
      rate: settings.rate,
      voiceId: settings.voiceId ?? null,
      includeChime: settings.chimeEnabled !== false,
    });
    if (res?.ok) {
      // Prefer showing the actual voice short-name the main process
      // resolved (e.g. 'fr-FR-VivienneMultilingualNeural'). The settings
      // UI can map this to the friendly catalog name.
      return { path: 'kiosk-server', voice: res.voice ?? settings.voiceId ?? '' };
    }
    return { path: 'failed', voice: '', reason: res?.error ?? 'unknown' };
  } catch (e: any) {
    return { path: 'failed', voice: '', reason: `ipc: ${e?.message ?? e}` };
  }
}

/**
 * Speak a ticket announcement. Uses Electron main-process audio
 * playback (sound-play) via the new `voice:announce` IPC — no renderer
 * autoplay/CSP hurdles. Falls back to the HTTP /api/tts path only if
 * the IPC isn't available (older build). No browser speechSynthesis
 * fallback anywhere — silence > Zira.
 */
export async function speak(text: string, settings: VoiceSettings, fallbackLocale = 'en-US'): Promise<SpeakResult> {
  if (!settings.enabled) return { path: 'failed', voice: '', reason: 'disabled' };
  const lang = resolveLocale(settings, fallbackLocale);

  // Device-routed playback first when the admin has picked a specific
  // output — this is the ONLY way to reach a non-default sink (PA
  // amp, USB speaker, …). If setSinkId fails for any reason we fall
  // through to the main-process path so the operator still hears the
  // announcement on the system default.
  if (settings.outputDeviceId) {
    const routed = await speakViaDevice(text, lang, settings);
    if (routed.path === 'kiosk-server') return routed;
    console.warn('[voice] device-routed playback failed, falling back to default sink:', routed.reason);
  }

  const mainResult = await speakViaMainProcess(text, lang, settings);
  if (mainResult.path === 'kiosk-server') return mainResult;

  // Fallback: older builds without the IPC — try the HTTP fetch path.
  const httpResult = await speakViaKioskServer(text, lang, settings);
  if (httpResult.path === 'kiosk-server') return httpResult;

  return { path: 'failed', voice: '', reason: `main: ${mainResult.reason}; http: ${httpResult.reason}` };
}

/** Localized sample used by the "Test voice" button. */
export function buildSample(locale: string): string {
  const l = locale.slice(0, 2).toLowerCase();
  if (l === 'ar') return 'التذكرة رقم 79، توجه إلى المكتب رقم 1.';
  if (l === 'fr') return 'Ticket numéro 79, veuillez vous rendre au guichet numéro 1.';
  return 'Ticket number 79, please proceed to desk 1.';
}
