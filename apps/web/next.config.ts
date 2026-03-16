import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable standalone output for Electron desktop bundling
  // Requires admin/developer mode on Windows for symlinks
  ...(process.env.BUILD_STANDALONE === 'true' ? { output: 'standalone' as const } : {}),
  outputFileTracingRoot: path.resolve(__dirname, '..', '..'),
  transpilePackages: ['@queueflow/shared', '@queueflow/ui'],
  // Allow access from Cloudflare tunnel and local network
  allowedDevOrigins: [
    '*.trycloudflare.com',
    'qflow.sihadz.com',
    '127.0.0.1',
    'localhost',
    '192.168.50.121',
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://192.168.50.121:3000',
    'http://127.0.0.1:3100',
    'http://localhost:3100',
  ],

  // Ensure AASA file is served with correct content type for iOS App Clips
  async headers() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
        ],
      },
    ];
  },
};

export default nextConfig;
