import { createBrowserClient } from '@supabase/ssr';

interface RuntimeConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

let cachedConfig: RuntimeConfig | null = null;

/**
 * Get Supabase config, supporting both standard web deployment
 * (build-time NEXT_PUBLIC_* vars) and Electron portable mode
 * (runtime config via IPC or API route).
 */
async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (cachedConfig) return cachedConfig;

  // Check if running in Electron with getConfig IPC
  if (typeof window !== 'undefined' && (window as any).electronAPI?.getConfig) {
    try {
      const config = await (window as any).electronAPI.getConfig();
      if (config.supabaseUrl && config.supabaseAnonKey) {
        cachedConfig = {
          supabaseUrl: config.supabaseUrl,
          supabaseAnonKey: config.supabaseAnonKey,
        };
        return cachedConfig;
      }
    } catch {
      // Fall through to env vars
    }
  }

  // Standard web mode: use build-time env vars
  cachedConfig = {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  };
  return cachedConfig;
}

/**
 * Create a Supabase browser client.
 * Uses build-time env vars by default, or runtime config in Electron portable mode.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/**
 * Create a Supabase client with runtime config support.
 * Use this in Electron/portable contexts where env vars may not be baked in.
 */
export async function createClientWithRuntimeConfig() {
  const config = await getRuntimeConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error('Supabase configuration not available. Check config.json or environment variables.');
  }
  return createBrowserClient(config.supabaseUrl, config.supabaseAnonKey);
}
