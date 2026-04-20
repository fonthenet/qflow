/**
 * TTS generation + on-disk cache for the customer display.
 *
 * Uses Microsoft Edge's free "Read Aloud" neural voices via `msedge-tts`.
 * Same voices Azure bills for (Vivienne, Denise, Zariyah, Amina, Aria, …)
 * but zero API key and zero per-call cost — Microsoft exposes the endpoint
 * for Edge users and the protocol is reachable from any Node client.
 *
 * The first call for a given (text, voice) pair generates the MP3 and
 * caches it under userData/tts-cache/. Every subsequent call for the same
 * (text, voice) reads from disk — typical ticket numbers repeat every
 * business day so the cache hit rate settles above 95% quickly.
 *
 * If Edge's endpoint is unreachable (offline, firewall), the endpoint
 * returns 503 and the display falls back to the browser's built-in
 * speechSynthesis so ticket calls never go silent.
 */
import { app } from 'electron';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from './logger';

// Voice catalog — (gender, language) -> Edge neural voice name. Picked
// after listening to samples; the Multilingual Neural variants are the
// newest and most natural-sounding. Arabic uses Algerian voices to match
// the primary customer base.
const VOICES: Record<string, Record<string, string>> = {
  fr: {
    female: 'fr-FR-VivienneMultilingualNeural',
    male: 'fr-FR-RemyMultilingualNeural',
  },
  ar: {
    female: 'ar-DZ-AminaNeural',
    male: 'ar-DZ-IsmaelNeural',
  },
  en: {
    female: 'en-US-AriaNeural',
    male: 'en-US-GuyNeural',
  },
};

export function pickVoice(language: string, gender: string): string {
  const lang = (language || 'en').slice(0, 2).toLowerCase();
  const g = gender === 'male' ? 'male' : 'female';
  return (VOICES[lang] || VOICES.en)[g];
}

function cacheDir(): string {
  const dir = join(app.getPath('userData'), 'tts-cache');
  return dir;
}

function cacheKey(text: string, voice: string, rate: number): string {
  const hash = createHash('sha1').update(`${voice}|${rate}|${text}`).digest('hex').slice(0, 16);
  return `${voice}-${rate}-${hash}.mp3`;
}

let ensureDirPromise: Promise<void> | null = null;
function ensureCacheDir(): Promise<void> {
  if (!ensureDirPromise) {
    ensureDirPromise = fs.mkdir(cacheDir(), { recursive: true }).then(() => undefined);
  }
  return ensureDirPromise;
}

/**
 * Return a cached MP3 buffer for (text, voice, rate), generating it via
 * Edge TTS and writing to disk on cache miss. Returns null if generation
 * fails (offline / Edge endpoint unreachable) so the caller can fall back
 * to browser speechSynthesis without a visible error.
 */
export async function getTtsAudio(
  text: string,
  voice: string,
  rate: number, // percentage, 60-130
): Promise<Buffer | null> {
  if (!text || !voice) return null;
  await ensureCacheDir();
  const file = join(cacheDir(), cacheKey(text, voice, rate));

  // Cache hit — fastest path, no network.
  try {
    return await fs.readFile(file);
  } catch {
    // fall through to generate
  }

  try {
    // Dynamic import keeps msedge-tts out of the startup critical path.
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    // msedge-tts rate is "+N%"/"-N%". Our rate is 60-130 as percentage of
    // normal; convert so 90% becomes -10% etc.
    const pct = Math.round(rate - 100);
    const sign = pct >= 0 ? '+' : '';
    const ratePct = `${sign}${pct}%`;
    const result = await tts.toStream(text, { rate: ratePct });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      result.audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
      result.audioStream.on('close', () => resolve());
      result.audioStream.on('error', reject);
    });
    const buffer = Buffer.concat(chunks);
    // Write cache asynchronously — don't block the response on disk I/O.
    fs.writeFile(file, buffer).catch((err) => logger.warn('tts', 'cache write failed', { error: err?.message }));
    return buffer;
  } catch (err: any) {
    logger.warn('tts', 'generation failed — display will fall back to browser TTS', {
      voice,
      error: err?.message,
    });
    return null;
  }
}
