import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable standalone output for Electron desktop bundling
  // Requires admin/developer mode on Windows for symlinks
  ...(process.env.BUILD_STANDALONE === 'true' ? { output: 'standalone' as const } : {}),
  transpilePackages: ['@queueflow/shared', '@queueflow/ui'],
  // Allow access from Cloudflare tunnel and local network
  allowedDevOrigins: ['*.trycloudflare.com', 'qflow.sihadz.com'],
};

export default nextConfig;
