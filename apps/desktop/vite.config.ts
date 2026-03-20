import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import path from 'path';
import fs from 'fs';

// Copy electron/kiosk/ static assets to dist-electron/kiosk/
function copyKioskAssets(): Plugin {
  return {
    name: 'copy-kiosk-assets',
    writeBundle() {
      const src = path.resolve(__dirname, 'electron/kiosk');
      const dest = path.resolve(__dirname, 'dist-electron/kiosk');
      if (!fs.existsSync(src)) return;
      fs.mkdirSync(dest, { recursive: true });
      for (const file of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, file), path.join(dest, file));
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['better-sqlite3', 'electron', 'electron-updater', 'qrcode'],
            },
          },
          plugins: [copyKioskAssets()],
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) { args.reload(); },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
  },
});
