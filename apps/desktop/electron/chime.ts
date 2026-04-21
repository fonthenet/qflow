/**
 * DMV-style three-tone chime generator for ticket announcements.
 *
 * Produces a small PCM WAV buffer for a "ding-dong-dang" triad —
 * descending major-third pattern (G5 → E5 → C5) with short attack /
 * decay envelopes so it sounds like a real public-address chime, not a
 * buzzer. Generated once at startup and cached to disk so the voice
 * pipeline just hands sound-play a file path.
 *
 * Why WAV not MP3: no encoder dependency, trivially correct at this
 * size (~35 KB), and Windows Media Player (what sound-play shells to)
 * plays it natively without loading extra codecs.
 */
import { app } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';

const SAMPLE_RATE = 44100;
const BIT_DEPTH = 16;

/** Generate a single sine tone with linear attack + exponential release. */
function makeTone(freq: number, durationMs: number, volume = 0.35): number[] {
  const samples = Math.round((durationMs / 1000) * SAMPLE_RATE);
  const attack = Math.min(0.02, durationMs / 1000 / 4);
  const data: number[] = new Array(samples);
  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE;
    // Envelope: linear attack, exponential decay for a pleasant chime.
    let env = 1;
    if (t < attack) env = t / attack;
    else env = Math.exp(-3 * (t - attack));
    data[i] = Math.sin(2 * Math.PI * freq * t) * volume * env;
  }
  return data;
}

/** Silence between tones, in samples. */
function silence(durationMs: number): number[] {
  return new Array(Math.round((durationMs / 1000) * SAMPLE_RATE)).fill(0);
}

/** Concatenate float samples, clamp to int16, and wrap in a WAV container. */
function encodeWav(samples: number[]): Buffer {
  const dataSize = samples.length * (BIT_DEPTH / 8);
  const buf = Buffer.alloc(44 + dataSize);
  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  // fmt chunk
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);               // subchunk1 size
  buf.writeUInt16LE(1, 20);                // PCM
  buf.writeUInt16LE(1, 22);                // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * (BIT_DEPTH / 8), 28); // byte rate
  buf.writeUInt16LE(BIT_DEPTH / 8, 32);    // block align
  buf.writeUInt16LE(BIT_DEPTH, 34);
  // data chunk
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

/** Three-tone PA chime: G5 (784 Hz) → E5 (659 Hz) → C5 (523 Hz). */
function buildChime(): Buffer {
  const tone1 = makeTone(784, 260);
  const tone2 = makeTone(659, 260);
  const tone3 = makeTone(523, 420);
  const gap = silence(40);
  const samples = [...tone1, ...gap, ...tone2, ...gap, ...tone3];
  return encodeWav(samples);
}

/** 400ms of digital silence. Used to wake the Windows Media Player
 *  sink before playing the real chime — each `sound-play` invocation
 *  launches a cold PowerShell process, and the first ~300ms of audio
 *  is clipped while the audio device opens. Playing this silent file
 *  first absorbs that clip so the actual chime comes out intact. */
function buildSilence(): Buffer {
  return encodeWav(silence(400));
}

/** Supported audio extensions — anything sound-play / WMP handles natively. */
const CUSTOM_CHIME_EXTS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.wma'];
const CUSTOM_CHIME_BASENAME = 'chime-custom';
const DEFAULT_CHIME_BASENAME = 'chime-ding-dong-dang.wav';
const MAX_CHIME_BYTES = 5 * 1024 * 1024; // 5 MB — plenty for any reasonable chime

function chimeDir(): string {
  return join(app.getPath('userData'), 'tts-cache');
}

async function findCustomChime(): Promise<string | null> {
  try {
    const entries = await fs.readdir(chimeDir());
    const match = entries.find((name) => {
      const lower = name.toLowerCase();
      return lower.startsWith(CUSTOM_CHIME_BASENAME + '.')
        && CUSTOM_CHIME_EXTS.includes('.' + lower.split('.').pop());
    });
    if (!match) return null;
    return join(chimeDir(), match);
  } catch {
    return null;
  }
}

/**
 * Path to the platform default chime inside the packaged app. Shipped
 * at `assets/default-chime.mp3` — the warm PA-style sound approved as
 * the standard for all Qflo businesses. `app.getAppPath()` resolves to
 * the asar root in packaged builds and the project root in dev, so the
 * same code path works everywhere.
 */
function bundledDefaultChimePath(): string {
  return join(app.getAppPath(), 'assets', 'default-chime.mp3');
}

async function ensureDefaultChime(): Promise<string> {
  await fs.mkdir(chimeDir(), { recursive: true });

  // Prefer the bundled MP3 when it ships with the app — this is the
  // canonical default every new business should hear. Copying it into
  // userData lets sound-play consume a real filesystem path even when
  // the source lives inside app.asar (which isn't always readable by
  // the PowerShell + MediaPlayer pipeline).
  const bundled = bundledDefaultChimePath();
  const bundledCopy = join(chimeDir(), 'chime-bundled-default.mp3');
  try {
    const [bundledStat, copyStat] = await Promise.all([
      fs.stat(bundled),
      fs.stat(bundledCopy).catch(() => null),
    ]);
    // Copy once, or re-copy if the bundled version was updated in a
    // newer app release (compare size + mtime).
    if (!copyStat || copyStat.size !== bundledStat.size
        || copyStat.mtimeMs < bundledStat.mtimeMs) {
      await fs.copyFile(bundled, bundledCopy);
    }
    return bundledCopy;
  } catch {
    // Bundled asset missing (shouldn't happen in a published build, but
    // we don't want the app to go silent if someone ran a dev build
    // without copying assets). Fall through to the generated WAV.
  }

  const wavFile = join(chimeDir(), DEFAULT_CHIME_BASENAME);
  try { await fs.access(wavFile); }
  catch { await fs.writeFile(wavFile, buildChime()); }
  return wavFile;
}

/**
 * Path to a 400ms silent WAV used to wake the PowerShell + Media Player
 * audio pipeline immediately before the real chime plays. Writing this
 * file once and reusing it — the contents never change.
 */
const SILENCE_WARMUP_BASENAME = 'silence-warmup.wav';
export async function getSilenceWarmupPath(): Promise<string> {
  await fs.mkdir(chimeDir(), { recursive: true });
  const file = join(chimeDir(), SILENCE_WARMUP_BASENAME);
  try { await fs.access(file); }
  catch { await fs.writeFile(file, buildSilence()); }
  return file;
}

/**
 * Return a filesystem path to the active chime — the admin's uploaded
 * file if one is installed, otherwise the built-in three-tone WAV.
 * Generated + cached on first call; re-checks disk on each call so a
 * freshly-uploaded chime takes effect on the very next announcement
 * without needing an app restart.
 */
export async function getChimePath(): Promise<string> {
  const custom = await findCustomChime();
  if (custom) return custom;
  return ensureDefaultChime();
}

/** Exact duration of the built-in three-tone chime (see buildChime). */
const DEFAULT_CHIME_MS = 260 + 40 + 260 + 40 + 420;

/**
 * Estimate the active chime's duration in ms so the voice can be
 * scheduled to start right after the chime ends (no overlap, no dead
 * air). Exact for WAV (header-parsed); approximate for compressed
 * formats via a conservative 128-kbps-equivalent byte-rate estimate.
 */
export async function getChimeDurationMs(): Promise<number> {
  const custom = await findCustomChime();
  if (!custom) return DEFAULT_CHIME_MS;
  try {
    const ext = ('.' + (custom.split('.').pop() ?? '')).toLowerCase();
    if (ext === '.wav') {
      // Read the first 44 bytes — standard WAV header — then derive
      // duration from sample rate, bit depth, channels, and data size.
      const fd = await fs.open(custom, 'r');
      try {
        const header = Buffer.alloc(44);
        await fd.read(header, 0, 44, 0);
        const sampleRate = header.readUInt32LE(24);
        const byteRate = header.readUInt32LE(28);
        const dataSize = header.readUInt32LE(40);
        if (byteRate > 0 && dataSize > 0) {
          return Math.round((dataSize / byteRate) * 1000);
        }
        if (sampleRate > 0) {
          const stat = await fs.stat(custom);
          return Math.round(((stat.size - 44) / (sampleRate * 2)) * 1000);
        }
      } finally {
        await fd.close();
      }
    }
    // Compressed audio (MP3/OGG/AAC/M4A/WMA) — approximate via file size
    // assuming ~128 kbps. Good enough for chime timing; worst case we're
    // ±300 ms which is imperceptible relative to an announcement.
    const stat = await fs.stat(custom);
    const BYTES_PER_SECOND_128KBPS = 16000;
    const estimated = Math.round((stat.size / BYTES_PER_SECOND_128KBPS) * 1000);
    // Clamp to a sane range — reject laughably-small or overlong values
    // (a 5 MB chime would return 320s otherwise; no one wants that).
    return Math.max(300, Math.min(estimated, 8000));
  } catch {
    return DEFAULT_CHIME_MS;
  }
}

/**
 * Copy an admin-uploaded audio file into the userData dir as the active
 * chime. Validates extension + size; rejects on anything the audio
 * pipeline can't play reliably. Removes any previous custom chime so
 * only one lives on disk at a time.
 */
export async function installCustomChime(sourcePath: string): Promise<{
  ok: boolean; error?: string; path?: string;
}> {
  try {
    const ext = ('.' + (sourcePath.split('.').pop() ?? '')).toLowerCase();
    if (!CUSTOM_CHIME_EXTS.includes(ext)) {
      return { ok: false, error: `Unsupported format ${ext}. Use MP3, WAV, OGG, M4A, AAC, or WMA.` };
    }
    const stat = await fs.stat(sourcePath);
    if (!stat.isFile()) return { ok: false, error: 'Not a regular file' };
    if (stat.size > MAX_CHIME_BYTES) {
      return { ok: false, error: `File too large (${Math.round(stat.size / 1024 / 1024)} MB > 5 MB)` };
    }
    if (stat.size < 64) return { ok: false, error: 'File is empty or truncated' };

    await fs.mkdir(chimeDir(), { recursive: true });
    // Remove any previous custom chime so the dir has at most one.
    await clearCustomChime();
    const dest = join(chimeDir(), `${CUSTOM_CHIME_BASENAME}${ext}`);
    await fs.copyFile(sourcePath, dest);
    return { ok: true, path: dest };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/** Remove the admin-uploaded chime, reverting to the built-in default. */
export async function clearCustomChime(): Promise<void> {
  try {
    const entries = await fs.readdir(chimeDir());
    await Promise.all(
      entries
        .filter((n) => n.toLowerCase().startsWith(CUSTOM_CHIME_BASENAME + '.'))
        .map((n) => fs.unlink(join(chimeDir(), n)).catch(() => {})),
    );
  } catch { /* dir doesn't exist yet — nothing to clear */ }
}

/** Whether a custom chime is currently installed (for the settings UI). */
export async function hasCustomChime(): Promise<boolean> {
  return (await findCustomChime()) !== null;
}
