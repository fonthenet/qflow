const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const BLUE_TOP = '#2563eb';
const BLUE_BOTTOM = '#1e40af';
const WHITE = '#ffffff';
const fontsDir = path.join(__dirname, 'fonts');
const outDir = path.join(__dirname, 'font-previews');

const fonts = [
  { name: 'Nunito', file: 'Nunito.ttf' },
  { name: 'Rubik', file: 'Rubik.ttf' },
  { name: 'Quicksand', file: 'Quicksand.ttf' },
];

async function generate() {
  for (const font of fonts) {
    const fontB64 = fs.readFileSync(path.join(fontsDir, font.file)).toString('base64');
    const w = 1024, h = 1024;
    const cx = w / 2, cy = h / 2;
    // Match the green icon layout: big Q centered, "flow" below with space
    const qSize = w * 0.52;
    const flowSize = w * 0.105;
    const qY = cy - h * 0.05;
    const flowY = qY + qSize * 0.44 + h * 0.06;

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
  <rect width="${w}" height="${h}" rx="${w * 0.22}" fill="url(#bg)"/>
  <rect width="${w}" height="${h * 0.5}" rx="${w * 0.22}" fill="rgba(255,255,255,0.06)"/>
  <text x="${cx}" y="${qY}" text-anchor="middle" dominant-baseline="central" font-family="'${font.name}'" font-weight="800" font-size="${qSize}" fill="${WHITE}">Q</text>
  <text x="${cx}" y="${flowY}" text-anchor="middle" dominant-baseline="central" font-family="'${font.name}'" font-weight="700" font-size="${flowSize}" fill="rgba(255,255,255,0.9)">flow</text>
</svg>`;

    await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(path.join(outDir, `${font.name}.png`));
    console.log(`✓ ${font.name}`);
  }
}

generate().catch(console.error);
