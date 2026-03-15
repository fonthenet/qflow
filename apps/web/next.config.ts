import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable standalone output for Electron desktop bundling
  // Requires admin/developer mode on Windows for symlinks
  ...(process.env.BUILD_STANDALONE === 'true' ? { output: 'standalone' as const } : {}),
  transpilePackages: ['@queueflow/shared', '@queueflow/ui'],
  // Allow access from Cloudflare tunnel and local network
  allowedDevOrigins: ['*.trycloudflare.com', 'qflow.sihadz.com', '192.168.50.52', 'localhost'],

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
