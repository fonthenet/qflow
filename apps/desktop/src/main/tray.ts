import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

let tray: Tray | null = null;

function createTrayIcon(): Electron.NativeImage {
  // Try to load icon from resources
  const iconPath = path.join(__dirname, '../../resources/icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }

  // Create a simple 16x16 icon programmatically
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      // Create a simple "Q" shaped icon in blue
      const cx = size / 2;
      const cy = size / 2;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

      if (dist >= 4 && dist <= 7) {
        // Ring
        canvas[offset] = 59;     // R
        canvas[offset + 1] = 130; // G
        canvas[offset + 2] = 246; // B
        canvas[offset + 3] = 255; // A
      } else if (x >= 9 && x <= 13 && y >= 9 && y <= 13 && x === y) {
        // Tail of Q
        canvas[offset] = 59;
        canvas[offset + 1] = 130;
        canvas[offset + 2] = 246;
        canvas[offset + 3] = 255;
      } else {
        // Transparent
        canvas[offset] = 0;
        canvas[offset + 1] = 0;
        canvas[offset + 2] = 0;
        canvas[offset + 3] = 0;
      }
    }
  }

  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

export function createTray(mainWindow: BrowserWindow): Tray {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('QueueFlow');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show QueueFlow',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: 'Connection Status: Checking...',
      enabled: false,
      id: 'connection-status',
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  return tray;
}
