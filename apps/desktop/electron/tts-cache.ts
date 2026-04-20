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
import { spawn } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveVoiceId } from '@qflo/shared';
import { logger } from './logger';

/**
 * Pick the Edge neural voice short-name. Defers to the shared catalog
 * so the Station, the portal, and the TTS server all agree on names,
 * defaults, and fallbacks.
 *
 * `explicitId` wins when present (user picked a specific voice like
 * 'Zariyah' or 'Denise'); otherwise falls back to the default for the
 * requested (language, gender) pair.
 */
export function pickVoice(language: string, gender: string, explicitId?: string | null): string {
  return resolveVoiceId(explicitId ?? null, language, gender);
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

  // Shell out to the Python `edge-tts` CLI. We also have the npm
  // `msedge-tts` package, but inside Electron main the Undici-backed
  // global WebSocket can't reach speech.platform.bing.com reliably and
  // hangs the handshake. The Python CLI uses its own WebSocket client
  // and generates audio consistently. Python + edge-tts are a soft
  // dependency — if they're missing we fall back to browser TTS.
  const OVERALL_TIMEOUT_MS = 10000;
  const tmpFile = join(tmpdir(), `qflo-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
  // edge-tts rate: "+N%" / "-N%". Our rate is 60-130 = percentage of normal.
  const pct = Math.round(rate - 100);
  const sign = pct >= 0 ? '+' : '';
  const ratePct = `${sign}${pct}%`;

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('edge-tts', [
        '--voice', voice,
        // Use =value form — argparse otherwise misreads +0% as a new flag
        `--rate=${ratePct}`,
        '--text', text,
        '--write-media', tmpFile,
      ], { windowsHide: true });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error('edge-tts timeout'));
      }, OVERALL_TIMEOUT_MS);
      proc.on('error', (err) => { clearTimeout(timer); reject(err); });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`edge-tts exited ${code}: ${stderr.slice(0, 300)}`));
      });
    });
    const buffer = await fs.readFile(tmpFile);
    fs.unlink(tmpFile).catch(() => {});
    // Write cache asynchronously — don't block the response on disk I/O.
    fs.writeFile(file, buffer).catch((err) => logger.warn('tts', 'cache write failed', { error: err?.message }));
    logger.info('tts', 'generated', { voice, bytes: buffer.length });
    return buffer;
  } catch (err: any) {
    // Cleanup any partial temp file.
    fs.unlink(tmpFile).catch(() => {});
    logger.warn('tts', 'generation failed — display will fall back to browser TTS', {
      voice,
      error: err?.message,
    });
    return null;
  }
}
