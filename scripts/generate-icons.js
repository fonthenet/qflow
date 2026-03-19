const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

function iconSvg(size, flat = false) {
  // Blue gradient background with Q and flow text
  // Q: 55% of canvas height, flow: 15% of canvas height
  // Positioned so the pair is vertically centered
  const qFontSize = Math.round(size * 0.65);
  const flowFontSize = Math.round(size * 0.16);
  const gap = Math.round(size * 0.01);

  // Center of Q, flow sits just below with minimal gap
  const qY = Math.round(size * 0.44);
  const flowY = qY + Math.round(qFontSize * 0.32) + gap + Math.round(flowFontSize * 0.6);

  const gradient = !flat;
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  ${gradient ? `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#1e40af"/>
    </linearGradient>
  </defs>` : ''}
  <rect width="${size}" height="${size}" fill="${gradient ? 'url(#bg)' : '#2563eb'}"/>
  <text x="50%" y="${qY}" text-anchor="middle" dominant-baseline="central"
        font-family="SF Pro Display, Helvetica Neue, Arial, sans-serif"
        font-weight="700" font-size="${qFontSize}" fill="white"
        letter-spacing="-2">Q</text>
  <text x="50%" y="${flowY}" text-anchor="middle" dominant-baseline="central"
        font-family="SF Pro Display, Helvetica Neue, Arial, sans-serif"
        font-weight="600" font-size="${flowFontSize}" fill="white"
        letter-spacing="1">flow</text>
</svg>`;
}

async function generateMaster(outputPath, size) {
  await sharp(Buffer.from(iconSvg(size)))
    .resize(size, size)
    .png()
    .toFile(outputPath);
}

async function toIco(pngPath, icoPath) {
  const png = await sharp(pngPath).resize(256, 256).png().toBuffer();
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);
  entry.writeUInt8(0, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);

  fs.writeFileSync(icoPath, Buffer.concat([header, entry, png]));
}

async function generate() {
  // Generate master 1024x1024
  const masterPath = path.join(ROOT, 'apps/expo/assets/icon.png');
  await generateMaster(masterPath, 1024);
  console.log('✓ Master 1024x1024');

  // ═══════════════════════════════════════
  // EXPO
  // ═══════════════════════════════════════
  const expoAssets = path.join(ROOT, 'apps/expo/assets');
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
  await toIco(masterPath, path.join(webPublic, 'favicon.ico'));
  console.log('✓ Web: all icons');

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

  const notifSizes = { mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 };
  for (const [density, size] of Object.entries(notifSizes)) {
    const dir = path.join(androidRes, `mipmap-${density}`);
    if (fs.existsSync(dir)) {
      await sharp(masterPath).resize(size, size).toFile(path.join(dir, 'ic_notification.png'));
    }
  }
  const drawableDir = path.join(androidRes, 'drawable');
  if (fs.existsSync(drawableDir)) {
    await sharp(masterPath).resize(96, 96).toFile(path.join(drawableDir, 'ic_notification.png'));
  }
  console.log('✓ Android: all icons');

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

  console.log('\n✅ ALL icons updated across all platforms!');
}

generate().catch(console.error);
