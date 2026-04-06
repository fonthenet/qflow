const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const BLUE_TOP = '#2563eb';
const BLUE_BOTTOM = '#1e40af';
const WHITE = '#ffffff';
const fontsDir = path.join(__dirname, 'fonts');
const outDir = path.join(__dirname, 'font-previews');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const fonts = [
  { name: 'SpaceGrotesk', file: 'SpaceGrotesk.ttf', style: 'Techy, geometric, unique Q tail' },
  { name: 'Sora', file: 'Sora.ttf', style: 'Modern Japanese-inspired geometric' },
  { name: 'PlusJakartaSans', file: 'PlusJakartaSans.ttf', style: 'Premium, slightly rounded' },
  { name: 'Urbanist', file: 'Urbanist.ttf', style: 'Clean geometric, thin strokes' },
  { name: 'Outfit', file: 'Outfit-Variable.ttf', style: 'Friendly geometric' },
  { name: 'ClashGrotesk', file: 'ClashGrotesk.ttf', style: 'Bold editorial feel' },
];

async function generate() {
  for (const font of fonts) {
    const fontB64 = fs.readFileSync(path.join(fontsDir, font.file)).toString('base64');
    const w = 1024, h = 1024;
    const cx = w / 2, cy = h / 2;
    const qSize = w * 0.55;
    const flowSize = w * 0.09;
    const qY = cy - h * 0.06;
    const flowY = qY + qSize * 0.42 + h * 0.05;
    const cornerR = w * 0.22;

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${BLUE_TOP}"/>
      <stop offset="100%" stop-color="${BLUE_BOTTOM}"/>
    </linearGradient>
    <style>
      @font-face {
        font-family: '${font.name}';
        src: url('data:font/truetype;base64,${fontB64}') format('truetype');
      }
    </style>
  </defs>
  <rect width="${w}" height="${h}" rx="${cornerR}" fill="url(#bg)"/>
  <rect width="${w}" height="${h * 0.5}" rx="${cornerR}" fill="rgba(255,255,255,0.06)"/>
  <text x="${cx}" y="${qY}" text-anchor="middle" dominant-baseline="central" font-family="'${font.name}'" font-weight="700" font-size="${qSize}" fill="${WHITE}">Q</text>
  <text x="${cx}" y="${flowY}" text-anchor="middle" dominant-baseline="central" font-family="'${font.name}'" font-weight="600" font-size="${flowSize}" fill="rgba(255,255,255,0.85)" letter-spacing="0.12em">flow</text>
</svg>`;

    await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(path.join(outDir, `${font.name}.png`));
    console.log(`✓ ${font.name} — ${font.style}`);
  }
  console.log(`\nPreviews saved in scripts/font-previews/`);
}

generate().catch(console.error);
