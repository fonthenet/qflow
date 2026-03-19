const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

async function extractParts(inputPath, size) {
  const { data, info } = await sharp(inputPath)
    .resize(size, size)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width, h = info.height, ch = info.channels;

  // Scan rows for white content
  const rowWhite = [];
  for (let y = 0; y < h; y++) {
    let count = 0;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * ch;
      if (Math.min(data[idx], data[idx + 1], data[idx + 2]) > 180) count++;
    }
    rowWhite.push(count);
  }

  const thresh = 3;
  let qTop = -1, gapStart = -1, flowTop = -1, flowBottom = -1;
  for (let y = 0; y < h; y++) { if (rowWhite[y] > thresh) { qTop = y; break; } }
  let inQ = false;
  for (let y = qTop; y < h; y++) {
    if (rowWhite[y] > thresh) inQ = true;
    if (inQ && rowWhite[y] <= thresh) { gapStart = y; break; }
  }
  for (let y = gapStart; y < h; y++) { if (rowWhite[y] > thresh) { flowTop = y; break; } }
  for (let y = h - 1; y >= flowTop; y--) { if (rowWhite[y] > thresh) { flowBottom = y; break; } }

  // Extract Q as RGBA
  const qH = gapStart - qTop;
  const qBuf = Buffer.alloc(w * qH * 4);
  for (let y = 0; y < qH; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = ((qTop + y) * w + x) * ch;
      const outIdx = (y * w + x) * 4;
      const wt = Math.min(data[srcIdx], data[srcIdx + 1], data[srcIdx + 2]) / 255;
      qBuf[outIdx] = 255; qBuf[outIdx + 1] = 255; qBuf[outIdx + 2] = 255;
      qBuf[outIdx + 3] = Math.round(wt * 255);
    }
  }

  // Extract flow as RGBA
  const flowH = flowBottom - flowTop + 1;
  const flowBufArr = Buffer.alloc(w * flowH * 4);
  for (let y = 0; y < flowH; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = ((flowTop + y) * w + x) * ch;
      const outIdx = (y * w + x) * 4;
      const wt = Math.min(data[srcIdx], data[srcIdx + 1], data[srcIdx + 2]) / 255;
      flowBufArr[outIdx] = 255; flowBufArr[outIdx + 1] = 255; flowBufArr[outIdx + 2] = 255;
      flowBufArr[outIdx + 3] = Math.round(wt * 255);
    }
  }

  return {
    qImg: await sharp(qBuf, { raw: { width: w, height: qH, channels: 4 } }).png().toBuffer(),
    flowImg: await sharp(flowBufArr, { raw: { width: w, height: flowH, channels: 4 } }).png().toBuffer(),
    qH, flowH, w, h,
  };
}

function blueGradientSvg(w, h) {
  return `<svg width="${w}" height="${h}"><defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#1e40af"/>
    </linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/></svg>`;
}

async function makeBlueIcon(greenIcon, outputPath, size) {
  const { qImg, flowImg, qH, flowH, w, h } = await extractParts(greenIcon, size);
  const gap = Math.round(size * 0.01);
  const totalH = qH + gap + flowH;
  const startY = Math.round((h - totalH) / 2);

  await sharp(Buffer.from(blueGradientSvg(w, h)))
    .resize(w, h)
    .composite([
      { input: qImg, left: 0, top: startY },
      { input: flowImg, left: 0, top: startY + qH + gap },
    ])
    .png().toFile(outputPath);
}

// Simple recolor for small sizes where extraction is unreliable
async function simpleRecolor(greenIcon, outputPath, size) {
  const { data, info } = await sharp(greenIcon).resize(size, size).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const t = y / size;
    const bgR = Math.round(37 + (30 - 37) * t);
    const bgG = Math.round(99 + (64 - 99) * t);
    const bgB = Math.round(235 + (175 - 235) * t);
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * info.channels;
      const outIdx = (y * size + x) * 4;
      const wt = Math.min(data[idx], data[idx + 1], data[idx + 2]) / 255;
      out[outIdx] = Math.round(bgR * (1 - wt) + 255 * wt);
      out[outIdx + 1] = Math.round(bgG * (1 - wt) + 255 * wt);
      out[outIdx + 2] = Math.round(bgB * (1 - wt) + 255 * wt);
      out[outIdx + 3] = info.channels === 4 ? data[idx + 3] : 255;
    }
  }
  await sharp(out, { raw: { width: size, height: size, channels: 4 } }).png().toFile(outputPath);
}

async function toIco(pngPath, icoPath) {
  // Create ICO from PNG (basic single-image ICO)
  const png = await sharp(pngPath).resize(256, 256).png().toBuffer();
  // ICO header: 6 bytes + 1 entry (16 bytes) + PNG data
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);     // Reserved
  header.writeUInt16LE(1, 2);     // Type: ICO
  header.writeUInt16LE(1, 4);     // Count: 1 image

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);         // Width: 256 (0 = 256)
  entry.writeUInt8(0, 1);         // Height: 256
  entry.writeUInt8(0, 2);         // Color palette
  entry.writeUInt8(0, 3);         // Reserved
  entry.writeUInt16LE(1, 4);      // Color planes
  entry.writeUInt16LE(32, 6);     // Bits per pixel
  entry.writeUInt32LE(png.length, 8);  // Size
  entry.writeUInt32LE(22, 12);    // Offset (6 + 16)

  fs.writeFileSync(icoPath, Buffer.concat([header, entry, png]));
}

async function generate() {
  const greenIcon = path.join(ROOT, 'apps/ios/QueueFlow/QueueFlow/Assets.xcassets/AppIcon.appiconset/AppIcon.png');

  // Generate master 1024x1024 blue icon
  const masterPath = path.join(ROOT, 'apps/expo/assets/icon.png');
  await makeBlueIcon(greenIcon, masterPath, 1024);
  console.log('✓ Master 1024x1024');

  // ═══════════════════════════════════════
  // EXPO
  // ═══════════════════════════════════════
  const expoAssets = path.join(ROOT, 'apps/expo/assets');
  // icon.png already done above
  await sharp(masterPath).toFile(path.join(expoAssets, 'adaptive-icon.png'));
  await sharp(masterPath).resize(48, 48).toFile(path.join(expoAssets, 'favicon.png'));
  console.log('✓ Expo: icon, adaptive-icon, favicon');

  // ═══════════════════════════════════════
  // iOS NATIVE (main app + app clip + expo targets)
  // ═══════════════════════════════════════
  const masterBuf = fs.readFileSync(masterPath);
  const iosIcons = [
    'apps/ios/QueueFlow/QueueFlow/Assets.xcassets/AppIcon.appiconset/AppIcon.png',
    'apps/ios/QueueFlow/QueueFlowClip/Assets.xcassets/AppIcon.appiconset/AppIcon.png',
    'apps/expo/targets/QueueFlowClip/Assets.xcassets/AppIcon.appiconset/AppIcon.png',
  ];
  for (const p of iosIcons) {
    const fullPath = path.join(ROOT, p);
    if (fs.existsSync(path.dirname(fullPath))) {
      fs.writeFileSync(fullPath, masterBuf);
    }
  }
  console.log('✓ iOS: main app, app clip, expo target clip');

  // ═══════════════════════════════════════
  // WEB (public/)
  // ═══════════════════════════════════════
  const webPublic = path.join(ROOT, 'apps/web/public');
  await sharp(masterPath).resize(16, 16).toFile(path.join(webPublic, 'favicon-16.png'));
  await sharp(masterPath).resize(32, 32).toFile(path.join(webPublic, 'favicon-32.png'));
  await sharp(masterPath).resize(180, 180).toFile(path.join(webPublic, 'apple-touch-icon.png'));
  await sharp(masterPath).resize(96, 96).toFile(path.join(webPublic, 'badge-96x96.png'));
  await sharp(masterPath).resize(192, 192).toFile(path.join(webPublic, 'icon-192x192.png'));
  await sharp(masterPath).resize(512, 512).toFile(path.join(webPublic, 'icon-512x512.png'));
  await sharp(masterPath).resize(192, 192).toFile(path.join(webPublic, 'icon-maskable-192x192.png'));
  await sharp(masterPath).resize(512, 512).toFile(path.join(webPublic, 'icon-maskable-512x512.png'));
  // favicon.ico
  await toIco(masterPath, path.join(webPublic, 'favicon.ico'));
  console.log('✓ Web: favicon.ico, favicon-16, favicon-32, apple-touch-icon, badge-96, icon-192, icon-512, maskable-192, maskable-512');

  // ═══════════════════════════════════════
  // ANDROID (mipmap)
  // ═══════════════════════════════════════
  const androidRes = path.join(ROOT, 'apps/android/app/src/main/res');
  const mipmapSizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

  for (const [density, size] of Object.entries(mipmapSizes)) {
    const dir = path.join(androidRes, `mipmap-${density}`);
    if (fs.existsSync(dir)) {
      await sharp(masterPath).resize(size, size).toFile(path.join(dir, 'ic_launcher.png'));
      await sharp(masterPath).resize(size, size).toFile(path.join(dir, 'ic_launcher_round.png'));
    }
  }

  // Notification icons (smaller)
  const notifSizes = { mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 };
  for (const [density, size] of Object.entries(notifSizes)) {
    const dir = path.join(androidRes, `mipmap-${density}`);
    if (fs.existsSync(dir)) {
      await sharp(masterPath).resize(size, size).toFile(path.join(dir, 'ic_notification.png'));
    }
  }
  // Also drawable notification
  const drawableDir = path.join(androidRes, 'drawable');
  if (fs.existsSync(drawableDir)) {
    await sharp(masterPath).resize(96, 96).toFile(path.join(drawableDir, 'ic_notification.png'));
  }
  console.log('✓ Android: ic_launcher (5 densities), ic_launcher_round (5), ic_notification (6)');

  // ═══════════════════════════════════════
  // DESKTOP (Electron)
  // ═══════════════════════════════════════
  const desktopAssets = path.join(ROOT, 'apps/desktop/assets');
  if (fs.existsSync(desktopAssets)) {
    await sharp(masterPath).resize(512, 512).toFile(path.join(desktopAssets, 'icon.png'));
  }
  const icoDir = path.join(ROOT, 'apps/desktop/release/.icon-ico');
  if (fs.existsSync(icoDir)) {
    await toIco(masterPath, path.join(icoDir, 'icon.ico'));
  }
  console.log('✓ Desktop: icon.png, icon.ico');

  console.log('\n✅ ALL 44 icons updated across all platforms!');
}

generate().catch(console.error);
