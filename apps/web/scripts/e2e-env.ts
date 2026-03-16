import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseEnvFile(contents: string) {
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const currentValue = process.env[key];
    if (currentValue) {
      continue;
    }

    const rawValue = line.slice(separatorIndex + 1).trim();
    const unwrapped =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;

    process.env[key] = unwrapped;
  }
}

export function loadLocalEnv() {
  for (const relativePath of ['.env.local', '.env']) {
    const filePath = resolve(process.cwd(), relativePath);
    if (existsSync(filePath)) {
      parseEnvFile(readFileSync(filePath, 'utf8'));
    }
  }
}

export function shouldShowHelp() {
  return process.argv.includes('--help') || process.argv.includes('-h');
}
