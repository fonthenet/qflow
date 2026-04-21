/**
 * Announcement chime for the Station.
 *
 * One source of truth: `assets/default-chime.mp3` is bundled with every
 * build and is the chime every Qflo business hears. Copied into
 * `userData/tts-cache/` on first use so the Windows sound-play pipeline
 * (PowerShell + Media Player) gets a real filesystem path — reading
 * directly from inside `app.asar` isn't reliable across Windows media
 * APIs. The copy is refreshed whenever the bundled MP3 changes in a
 * newer app release (size + mtime check).
 *
 * A short silent WAV is also generated once and kept alongside the
 * chime; it's played immediately before every announcement to warm the
 * audio sink so the chime's first frames aren't clipped by PowerShell
 * cold-start latency.
 */
import { app } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';

const SAMPLE_RATE = 44100;
const BIT_DEPTH = 16;
const CHIME_CACHE_NAME = 'chime.mp3';
const SILENCE_WARMUP_NAME = 'silence-warmup.wav';

function chimeDir(): string {
  return join(app.getPath('userData'), 'tts-cache');
}

function bundledChimePath(): string {
  // `app.getAppPath()` returns the asar root in packaged builds and the
  // project root in dev, so the same code path works everywhere.
  return join(app.getAppPath(), 'assets', 'default-chime.mp3');
}

/**
 * Ensure the bundled chime is available at a plain filesystem path and
 * return it. Copies into userData so:
 *   • sound-play / WMP never need to read from inside app.asar, and
 *   • legacy `userData/tts-cache/chime-*.{mp3,wav,…}` files left over
 *     from previous versions can be cleaned up out of band without
 *     affecting playback.
 *
 * Re-copies when the bundled asset changes (newer app release ships a
 * new sound). Size + mtime is enough — the MP3 rarely changes, and
 * doing a byte-compare on every announcement would be wasteful.
 */
export async function getChimePath(): Promise<string> {
  await fs.mkdir(chimeDir(), { recursive: true });
  const dest = join(chimeDir(), CHIME_CACHE_NAME);
  const src = bundledChimePath();
  try {
    const [srcStat, destStat] = await Promise.all([
      fs.stat(src),
      fs.stat(dest).catch(() => null),
    ]);
    if (!destStat || destStat.size !== srcStat.size || destStat.mtimeMs < srcStat.mtimeMs) {
      // readFile + writeFile (rather than copyFile) is the most
      // reliable way to pull bytes from inside app.asar on Windows.
      const bytes = await fs.readFile(src);
      await fs.writeFile(dest, bytes);
    }
    return dest;
  } catch {
    // Asset missing — dev build or broken package. Return the expected
    // userData path anyway; `sound-play` will throw and the voice
    // announcement will still play on its own.
    return dest;
  }
}

/** Best-effort duration estimate for the active chime. Used to budget
 *  the voice start time. 128 kbps ≈ 16 KB/s; clamped to a sane range. */
export async function getChimeDurationMs(): Promise<number> {
  try {
    const path = await getChimePath();
    const stat = await fs.stat(path);
    const BYTES_PER_SECOND_128KBPS = 16000;
    const estimated = Math.round((stat.size / BYTES_PER_SECOND_128KBPS) * 1000);
    return Math.max(300, Math.min(estimated, 8000));
  } catch {
    return 1500;
  }
}

// ── Silence warmup (unchanged) ────────────────────────────────────────
// Played at volume 1 for ~400ms before the chime to absorb the Windows
// Media Player cold-start latency that would otherwise clip the chime's
// first frames. WAV so no codec dependency.
function makeSilence(durationMs: number): number[] {
  return new Array(Math.round((durationMs / 1000) * SAMPLE_RATE)).fill(0);
}
function encodeWav(samples: number[]): Buffer {
  const dataSize = samples.length * (BIT_DEPTH / 8);
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * (BIT_DEPTH / 8), 28);
  buf.writeUInt16LE(BIT_DEPTH / 8, 32);
  buf.writeUInt16LE(BIT_DEPTH, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}
export async function getSilenceWarmupPath(): Promise<string> {
  await fs.mkdir(chimeDir(), { recursive: true });
  const file = join(chimeDir(), SILENCE_WARMUP_NAME);
  try { await fs.access(file); }
  catch { await fs.writeFile(file, encodeWav(makeSilence(400))); }
  return file;
}

/**
 * One-shot cleanup: wipe any legacy per-user chime files left in
 * userData from earlier builds so the bundled MP3 is the single source
 * of truth. Safe to call on every startup — runs in parallel, ignores
 * missing files, and doesn't touch anything outside tts-cache/.
 */
export async function cleanupLegacyChimeFiles(): Promise<void> {
  try {
    const entries = await fs.readdir(chimeDir());
    const stale = entries.filter((n) => {
      const lower = n.toLowerCase();
      if (lower === CHIME_CACHE_NAME) return false;
      if (lower === SILENCE_WARMUP_NAME) return false;
      return (
        lower.startsWith('chime-custom.') ||
        lower === 'chime-ding-dong-dang.wav' ||
        lower === 'chime-bundled-default.mp3'
      );
    });
    await Promise.all(stale.map((n) => fs.unlink(join(chimeDir(), n)).catch(() => {})));
  } catch { /* dir doesn't exist yet or can't be read — harmless */ }
}
