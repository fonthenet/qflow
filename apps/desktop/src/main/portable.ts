import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export interface PortableConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  appName: string;
  offlineOnly: boolean;
  autoSync: boolean;
  syncInterval: number;
}

const DEFAULT_CONFIG: PortableConfig = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  appName: 'QueueFlow',
  offlineOnly: false,
  autoSync: true,
  syncInterval: 30000,
};

let portableRoot: string | null = null;
let cachedConfig: PortableConfig | null = null;

/**
 * Detect portable mode by walking up from the exe directory
 * looking for a config.json marker file.
 */
export function isPortableMode(): boolean {
  if (portableRoot !== null) return true;

  // Start from the executable's directory
  let dir = path.dirname(app.getPath('exe'));

  // Walk up at most 3 levels (exe → QueueFlow → USB_ROOT)
  for (let i = 0; i < 4; i++) {
    const configPath = path.join(dir, 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        // Verify it's our config file (has expected keys)
        if (typeof content === 'object' && 'appName' in content) {
          portableRoot = dir;
          cachedConfig = { ...DEFAULT_CONFIG, ...content };
          console.log(`Portable mode detected. Root: ${portableRoot}`);
          return true;
        }
      } catch {
        // Invalid JSON, keep searching
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  return false;
}

/**
 * Get the USB root directory (where config.json lives).
 */
export function getPortableRoot(): string {
  if (!portableRoot) {
    throw new Error('Not in portable mode');
  }
  return portableRoot;
}

/**
 * Get the parsed portable config.
 */
export function getPortableConfig(): PortableConfig {
  if (cachedConfig) return cachedConfig;
  return DEFAULT_CONFIG;
}

/**
 * Get the data directory for storing DB, logs, etc.
 * Portable: USB_ROOT/QueueFlow/data/
 * Standard: app.getPath('userData')
 */
export function getDataDir(): string {
  if (portableRoot) {
    const dataDir = path.join(portableRoot, 'QueueFlow', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return dataDir;
  }
  return app.getPath('userData');
}

/**
 * Get the path to the bundled Node.js executable.
 * Portable: USB_ROOT/QueueFlow/node/node.exe
 * Standard: system 'node'
 */
export function getNodePath(): string {
  if (portableRoot) {
    const nodePath = path.join(portableRoot, 'QueueFlow', 'node', 'node.exe');
    if (fs.existsSync(nodePath)) {
      console.log(`Using bundled Node.js: ${nodePath}`);
      return nodePath;
    }
    console.warn('Bundled node.exe not found, falling back to system node');
  }
  return 'node';
}

/**
 * Inject portable config values into process.env so the Next.js
 * server picks them up.
 */
export function injectConfigToEnv(): void {
  const config = getPortableConfig();

  if (config.supabaseUrl) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = config.supabaseUrl;
  }
  if (config.supabaseAnonKey) {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = config.supabaseAnonKey;
  }

  // Set a flag so the app knows it's in portable mode
  process.env.QUEUEFLOW_PORTABLE = 'true';

  if (config.offlineOnly) {
    process.env.QUEUEFLOW_OFFLINE_ONLY = 'true';
  }

  console.log('Portable config injected into environment');
}
