import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, '..');
const nextDir = path.join(appDir, '.next');
const majorNodeVersion = Number.parseInt(process.versions.node.split('.')[0] || '0', 10);

if (majorNodeVersion >= 24) {
  console.error(
    [
      `Node ${process.versions.node} is too new for a stable Next.js dev experience in this project.`,
      'Use Node 22 LTS, then run `pnpm install` and `pnpm --filter @qflo/web dev` again.',
    ].join('\n')
  );
  process.exit(1);
}

if (existsSync(nextDir)) {
  rmSync(nextDir, { recursive: true, force: true });
  console.log('Removed stale .next cache');
}

if (process.platform === 'win32') {
  try {
    const output = execSync('netstat -ano | findstr :3000', {
      cwd: appDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    const pids = Array.from(
      new Set(
        output
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.split(/\s+/).at(-1))
          .filter((value) => value && /^\d+$/.test(value))
      )
    );

    for (const pid of pids) {
      execSync(`taskkill /PID ${pid} /F`, {
        cwd: appDir,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      console.log(`Stopped process on port 3000 (PID ${pid})`);
    }
  } catch {
    // No existing process was using port 3000.
  }
}

const env = {
  ...process.env,
  WATCHPACK_POLLING: process.platform === 'win32' ? 'true' : process.env.WATCHPACK_POLLING,
};

const child =
  process.platform === 'win32'
    ? spawn(process.env.comspec || 'cmd.exe', ['/d', '/s', '/c', 'pnpm exec next dev --port 3000'], {
        cwd: appDir,
        stdio: 'inherit',
        env,
        windowsVerbatimArguments: true,
      })
    : spawn('pnpm', ['exec', 'next', 'dev', '--port', '3000'], {
        cwd: appDir,
        stdio: 'inherit',
        env,
      });

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
