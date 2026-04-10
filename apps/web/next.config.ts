import path from 'node:path';
import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  // Enable standalone output for Electron desktop bundling
  // Requires admin/developer mode on Windows for symlinks
  ...(process.env.BUILD_STANDALONE === 'true' ? { output: 'standalone' as const } : {}),
  outputFileTracingRoot: path.resolve(__dirname, '..', '..'),
  transpilePackages: ['@qflo/shared', '@qflo/ui'],
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

  // Rewrite /station to static Station UI
  async rewrites() {
    return [
      {
        source: '/station',
        destination: '/station/index.html',
      },
    ];
  },

  // Ensure AASA file is served with correct content type for iOS App Clips
  // + security headers for all routes
  async headers() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Upload source maps for readable stack traces
  org: 'qflo',
  project: 'javascript-nextjs',

  // Suppress source map upload logs
  silent: !process.env.CI,

  // Automatically tree-shake Sentry logger in production
  disableLogger: true,

  // Upload source maps but don't expose them to clients
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
});
