/**
 * Offline-first TTS pre-warmer.
 *
 * The Station must keep announcing tickets when the internet drops. Edge
 * TTS is cloud-generated, so any number that hasn't been spoken before
 * produces silence while offline. The pre-warmer fixes this by walking a
 * fixed digit range (1..MAX_WARM_NUMBER) on first boot and turning every
 * "Ticket numéro N" / "التذكرة رقم N" / "Ticket number N" into an on-disk
 * MP3 — so once warming completes the Station never needs Edge again for
 * everyday ticket calls.
 *
 * Design goals (commercial-grade):
 *   • Idempotent — a manifest under userData/tts-cache/manifest.json
 *     tracks which (voice, rate) combos are fully warmed. Restarting the
 *     app never re-generates what's already on disk.
 *   • Throttled — Edge TTS is a free Microsoft endpoint; hammering it
 *     with 999 parallel requests is a good way to get IP-banned. We cap
 *     at PREWARM_CONCURRENCY and back off on any transient error.
 *   • Resumable — partial progress is persisted after every N items, so
 *     a network drop mid-warm picks up where it left off next launch.
 *   • Non-blocking — kicked off a few seconds after app ready so UI /
 *     Station window / SSE all come up first. Zero user-visible cost.
 *   • Scoped — only warms the currently-configured voice + rate. If the
 *     admin switches voice in Settings, the new combo is warmed on the
 *     next trigger; stale MP3s stay on disk as harmless filler.
 *
 * The cache keys MUST stay byte-identical to what `buildAnnouncement()`
 * produces in Station.tsx — otherwise the warmed MP3s never get hit at
 * playback time. See `announcementText()` below.
 */
import { app } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';
import { resolveVoiceId, arabicNumberToWords, type VoiceLanguage } from '@qflo/shared';
import { getTtsAudio } from './tts-cache';
import { logger } from './logger';

const MAX_WARM_NUMBER = 999;
const PREWARM_CONCURRENCY = 3;
const MANIFEST_NAME = 'prewarm-manifest.json';
const WARM_FAIL_COOLDOWN_MS = 10 * 60 * 1000; // back off 10 min after network failure

type WarmedEntry = {
  /** Highest contiguous ticket number warmed. Sparse gaps are ignored. */
  warmedUpTo: number;
  /** Ms epoch of last attempt (success or fail). */
  lastAttempt: number;
  /** Ms epoch of last successful completion (warmedUpTo === MAX_WARM_NUMBER). */
  completedAt?: number;
};

type Manifest = {
  version: 1;
  entries: Record<string, WarmedEntry>;
};

function manifestPath(): string {
  return join(app.getPath('userData'), 'tts-cache', MANIFEST_NAME);
}

async function readManifest(): Promise<Manifest> {
  try {
    const raw = await fs.readFile(manifestPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && parsed.entries) return parsed;
  } catch { /* first run or corrupt — start fresh */ }
  return { version: 1, entries: {} };
}

async function writeManifest(m: Manifest): Promise<void> {
  try {
    await fs.mkdir(join(app.getPath('userData'), 'tts-cache'), { recursive: true });
    await fs.writeFile(manifestPath(), JSON.stringify(m, null, 2), 'utf8');
  } catch (err: any) {
    logger.warn('tts-prewarm', 'manifest write failed', { error: err?.message });
  }
}

// Bump when the announcement text format changes (e.g. switching Arabic
// digits → MSA words). Older warmed manifest entries keyed with a
// different version are ignored, so the first launch after a format
// change re-warms fresh MP3s matching the new text.
const TEXT_FORMAT_VERSION = 2;

function entryKey(voice: string, rate: number): string {
  return `${voice}|${rate}|v${TEXT_FORMAT_VERSION}`;
}

/**
 * MUST match `buildAnnouncement()` in Station.tsx verbatim — cache keys
 * are hashed from this exact string. If the format here drifts (extra
 * space, different word), warmed MP3s become orphans.
 */
function announcementText(lang: VoiceLanguage, n: number): string {
  // MSA word form for Arabic keeps pronunciation consistent across DZ
  // and SA voices; see arabicNumberToWords() and the matching call in
  // Station.tsx's announceTicket helper.
  if (lang === 'ar') return `التذكرة رقم ${arabicNumberToWords(n)}`;
  if (lang === 'fr') return `Ticket numéro ${n}`;
  return `Ticket number ${n}`;
}

/** Fixed phrases the display plays alongside ticket numbers (audio-unlock
 *  greeting + test-voice sample). Warming them means the very first tap
 *  on a kiosk is instant even with no cached numbers yet. */
function fixedPhrases(lang: VoiceLanguage): string[] {
  if (lang === 'ar') {
    return ['تم تفعيل الإعلانات', 'التذكرة رقم 79، توجه إلى المكتب رقم 1.'];
  }
  if (lang === 'fr') {
    return ['Annonces activées', 'Ticket numéro 79, veuillez vous rendre au guichet numéro 1.'];
  }
  return ['Announcements ready', 'Ticket number 79, please proceed to desk 1.'];
}

function langFromVoiceId(voiceId: string): VoiceLanguage {
  const p = voiceId.slice(0, 2).toLowerCase();
  if (p === 'ar' || p === 'fr' || p === 'en') return p;
  return 'en';
}

/** Run `count` async workers over `items`, invoking `fn` on each.
 *  Stops early if `shouldAbort()` returns true between items. */
async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<boolean>,
  shouldAbort: () => boolean,
): Promise<{ ok: number; failed: number; aborted: boolean }> {
  let idx = 0;
  let ok = 0;
  let failed = 0;
  let aborted = false;
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      if (shouldAbort()) { aborted = true; return; }
      const myIdx = idx++;
      try {
        const result = await fn(items[myIdx]);
        if (result) ok++; else failed++;
      } catch {
        failed++;
      }
    }
  });
  await Promise.all(workers);
  return { ok, failed, aborted };
}

let runningFor = new Set<string>();

/**
 * Warm the configured voice + rate up to MAX_WARM_NUMBER. Safe to call
 * repeatedly: already-warmed combos short-circuit in O(1) via manifest.
 *
 * `settings` is read lazily so a change in the admin panel between
 * triggers picks up the newest values.
 */
export async function prewarmVoiceCache(opts: {
  voiceId?: string | null;
  language?: string;
  gender?: string;
  rate: number;
}): Promise<void> {
  const rate = Math.max(60, Math.min(130, Math.round(opts.rate || 90)));
  const voice = resolveVoiceId(opts.voiceId ?? null, opts.language ?? 'en', opts.gender ?? 'female');
  const lang = langFromVoiceId(voice);
  const key = entryKey(voice, rate);

  // Guard against overlapping runs — two quick settings-save triggers
  // shouldn't spawn two concurrent warmups of the same combo.
  if (runningFor.has(key)) {
    logger.debug('tts-prewarm', 'already running — skipping duplicate trigger', { voice, rate });
    return;
  }

  const manifest = await readManifest();
  const existing = manifest.entries[key];
  if (existing?.completedAt && existing.warmedUpTo >= MAX_WARM_NUMBER) {
    logger.debug('tts-prewarm', 'voice already fully warmed', { voice, rate });
    return;
  }

  // Back-off after recent network failure — avoid burning CPU on a
  // guaranteed-fail loop while the user is offline.
  if (existing?.lastAttempt && !existing.completedAt) {
    const since = Date.now() - existing.lastAttempt;
    if (since < WARM_FAIL_COOLDOWN_MS && (existing.warmedUpTo ?? 0) === 0) {
      logger.debug('tts-prewarm', 'in cooldown window — will retry later', {
        voice, rate, secondsLeft: Math.round((WARM_FAIL_COOLDOWN_MS - since) / 1000),
      });
      return;
    }
  }

  runningFor.add(key);
  const startedAt = Date.now();
  const resumeFrom = Math.max(1, (existing?.warmedUpTo ?? 0) + 1);

  // Canary request: if the very first item fails, Edge TTS is unreachable
  // (offline or blocked). Don't burn through 999 guaranteed-failures —
  // record the attempt and bail so the retry loop can pick up later.
  const canaryText = announcementText(lang, resumeFrom);
  const canary = await getTtsAudio(canaryText, voice, rate);
  if (!canary) {
    manifest.entries[key] = {
      warmedUpTo: existing?.warmedUpTo ?? 0,
      lastAttempt: startedAt,
    };
    await writeManifest(manifest);
    runningFor.delete(key);
    logger.info('tts-prewarm', 'canary failed — Edge TTS unreachable, will retry later', { voice, rate });
    return;
  }

  // Canary succeeded → do the rest. Bundle fixed phrases with the number
  // range so unlock / test-voice are covered in a single pass.
  const items: Array<{ label: string; text: string; n: number | null }> = [];
  for (const phrase of fixedPhrases(lang)) {
    items.push({ label: 'phrase', text: phrase, n: null });
  }
  for (let n = resumeFrom + 1; n <= MAX_WARM_NUMBER; n++) {
    items.push({ label: 'number', text: announcementText(lang, n), n });
  }

  logger.info('tts-prewarm', 'starting warmup', {
    voice, rate, lang, from: resumeFrom, to: MAX_WARM_NUMBER, pending: items.length + 1,
  });

  let highestContiguous = resumeFrom; // canary succeeded, so at least this much
  let abortNetwork = false;
  let consecutiveFails = 0;
  let itemsSinceSave = 0;

  const { ok, failed, aborted } = await runPool(
    items,
    PREWARM_CONCURRENCY,
    async (item) => {
      const buf = await getTtsAudio(item.text, voice, rate);
      if (!buf) {
        consecutiveFails++;
        // 5 consecutive failures probably means the network just dropped
        // — stop hammering and resume on the next trigger.
        if (consecutiveFails >= 5) abortNetwork = true;
        return false;
      }
      consecutiveFails = 0;
      if (item.n !== null && item.n === highestContiguous + 1) {
        highestContiguous = item.n;
      }
      // Persist progress periodically so a crash / quit mid-warm still
      // saves useful state.
      if (++itemsSinceSave >= 50) {
        itemsSinceSave = 0;
        manifest.entries[key] = {
          warmedUpTo: highestContiguous,
          lastAttempt: Date.now(),
        };
        await writeManifest(manifest);
      }
      return true;
    },
    () => abortNetwork,
  );

  const fullyDone = !aborted && highestContiguous >= MAX_WARM_NUMBER && failed === 0;
  manifest.entries[key] = {
    warmedUpTo: highestContiguous,
    lastAttempt: Date.now(),
    completedAt: fullyDone ? Date.now() : existing?.completedAt,
  };
  await writeManifest(manifest);
  runningFor.delete(key);

  logger.info('tts-prewarm', fullyDone ? 'warmup complete' : 'warmup paused', {
    voice, rate, ok, failed, aborted, highestContiguous,
    elapsedMs: Date.now() - startedAt,
  });
}

let retryTimer: NodeJS.Timeout | null = null;

/**
 * Schedule a background warmup pass. Called on app startup and after any
 * voice-settings change. Silent on failure — the manifest remembers and
 * a follow-up pass will resume automatically.
 */
export function scheduleTtsPrewarm(
  getSettings: () => { voiceId?: string | null; language?: string; gender?: string; rate?: number } | null,
  opts: { initialDelayMs?: number; retryIntervalMs?: number } = {},
): void {
  const initialDelay = opts.initialDelayMs ?? 6000;
  const retryInterval = opts.retryIntervalMs ?? 30 * 60 * 1000; // 30 min

  const runOnce = async () => {
    const s = getSettings();
    if (!s) return;
    try {
      await prewarmVoiceCache({
        voiceId: s.voiceId,
        language: s.language,
        gender: s.gender,
        rate: s.rate ?? 90,
      });
    } catch (err: any) {
      logger.warn('tts-prewarm', 'run threw — will retry on next tick', { error: err?.message });
    }
  };

  setTimeout(runOnce, initialDelay);
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = setInterval(runOnce, retryInterval);
}

/** Manual trigger — call after Settings save so a newly-picked voice is
 *  warmed without waiting for the next background tick. */
export function triggerTtsPrewarmNow(settings: {
  voiceId?: string | null; language?: string; gender?: string; rate?: number;
}): void {
  prewarmVoiceCache({
    voiceId: settings.voiceId,
    language: settings.language,
    gender: settings.gender,
    rate: settings.rate ?? 90,
  }).catch((err) => {
    logger.warn('tts-prewarm', 'manual trigger failed', { error: err?.message });
  });
}
