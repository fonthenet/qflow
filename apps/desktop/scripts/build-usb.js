/**
 * QueueFlow USB Portable Build Script
 *
 * Assembles a ready-to-copy USB folder from the electron-builder
 * unpacked output + bundled Node.js runtime.
 *
 * Usage:
 *   node scripts/build-usb.js [--node-path <path-to-node.exe>]
 *
 * Prerequisites:
 *   - Run `pnpm dist:portable` first (creates out/win-unpacked/)
 *   - Have a portable Node.js binary (node.exe) available
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const UNPACKED_DIR = path.join(ROOT, 'out', 'win-unpacked');
const USB_OUTPUT = path.join(ROOT, 'out', 'usb');
const QUEUEFLOW_DIR = path.join(USB_OUTPUT, 'QueueFlow');
const NODE_VERSION = '20.11.1'; // LTS version to bundle

// Parse args
const args = process.argv.slice(2);
let customNodePath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--node-path' && args[i + 1]) {
    customNodePath = args[i + 1];
    i++;
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`  Warning: source not found: ${src}`);
    return;
  }

  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

// ─── Step 1: Verify unpacked build exists ───────────────────────────

console.log('=== QueueFlow USB Build ===\n');

if (!fs.existsSync(UNPACKED_DIR)) {
  console.error(`Error: Unpacked build not found at ${UNPACKED_DIR}`);
  console.error('Run "pnpm dist:portable" first.');
  process.exit(1);
}

console.log(`Source: ${UNPACKED_DIR}`);
console.log(`Output: ${USB_OUTPUT}\n`);

// ─── Step 2: Clean and create USB directory structure ────────────────

console.log('Step 1: Creating USB directory structure...');

if (fs.existsSync(USB_OUTPUT)) {
  fs.rmSync(USB_OUTPUT, { recursive: true });
}

ensureDir(QUEUEFLOW_DIR);
ensureDir(path.join(QUEUEFLOW_DIR, 'data'));
ensureDir(path.join(QUEUEFLOW_DIR, 'data', 'logs'));
ensureDir(path.join(QUEUEFLOW_DIR, 'node'));

console.log('  Done.\n');

// ─── Step 3: Copy Electron app ──────────────────────────────────────

console.log('Step 2: Copying Electron app...');
copyRecursive(UNPACKED_DIR, QUEUEFLOW_DIR);
console.log('  Done.\n');

// ─── Step 4: Bundle Node.js ─────────────────────────────────────────

console.log('Step 3: Bundling Node.js runtime...');

const nodeDestDir = path.join(QUEUEFLOW_DIR, 'node');
const nodeExeDest = path.join(nodeDestDir, 'node.exe');

if (customNodePath) {
  // Use provided node.exe
  if (!fs.existsSync(customNodePath)) {
    console.error(`  Error: Node.js not found at ${customNodePath}`);
    process.exit(1);
  }
  fs.copyFileSync(customNodePath, nodeExeDest);
  console.log(`  Copied from: ${customNodePath}`);
} else {
  // Try to use current system node
  const systemNode = process.execPath;
  if (fs.existsSync(systemNode) && systemNode.endsWith('node.exe')) {
    fs.copyFileSync(systemNode, nodeExeDest);
    console.log(`  Copied system Node.js: ${systemNode}`);
  } else {
    console.warn('  Warning: Could not find node.exe to bundle.');
    console.warn(`  Please provide it manually: copy node.exe to ${nodeExeDest}`);
    console.warn(`  Or re-run with: node scripts/build-usb.js --node-path <path-to-node.exe>`);
  }
}

console.log('  Done.\n');

// ─── Step 4b: Install Next.js deps (flat, no symlinks) ──────────

console.log('Step 3b: Installing Next.js dependencies...');

const nextjsDir = path.join(QUEUEFLOW_DIR, 'resources', 'nextjs');
if (fs.existsSync(nextjsDir) && fs.existsSync(path.join(nextjsDir, 'package.json'))) {
  // Read the web app's package.json to get its dependencies
  const webPkg = JSON.parse(fs.readFileSync(path.join(nextjsDir, 'package.json'), 'utf-8'));

  // Create a minimal package.json — strip workspace: protocol refs
  const deps = { ...(webPkg.dependencies || {}) };
  // Remove workspace:* deps (internal packages bundled in .next already)
  for (const [key, val] of Object.entries(deps)) {
    if (typeof val === 'string' && val.startsWith('workspace:')) {
      delete deps[key];
    }
  }

  const minPkg = {
    name: 'queueflow-web-portable',
    version: '1.0.0',
    private: true,
    dependencies: deps,
  };

  writeFile(path.join(nextjsDir, 'package.json'), JSON.stringify(minPkg, null, 2));

  try {
    console.log('  Running npm install (flat node_modules, no symlinks)...');
    execSync('npm install --omit=dev --legacy-peer-deps', {
      cwd: nextjsDir,
      stdio: 'inherit',
      timeout: 180000,
    });
    console.log('  Dependencies installed successfully.');
  } catch (err) {
    console.error('  Error installing deps:', err.message);
  }

  // Also copy public dir if missing
  const publicDest = path.join(nextjsDir, 'public');
  const publicSrc = path.join(ROOT, '..', 'web', 'public');
  if (!fs.existsSync(publicDest) && fs.existsSync(publicSrc)) {
    console.log('  Copying public/ directory...');
    copyRecursive(publicSrc, publicDest);
  }
} else {
  console.warn('  Warning: nextjs dir or package.json not found in resources.');
}

console.log('  Done.\n');

// ─── Step 5: Generate USB root files ────────────────────────────────

console.log('Step 4: Generating USB root files...');

// autorun.inf
writeFile(
  path.join(USB_OUTPUT, 'autorun.inf'),
  `[autorun]\r\nlabel=QueueFlow\r\nicon=QueueFlow\\QueueFlow.exe,0\r\n`
);
console.log('  Created autorun.inf');

// config.json
writeFile(
  path.join(USB_OUTPUT, 'config.json'),
  JSON.stringify(
    {
      appName: 'QueueFlow',
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      offlineOnly: false,
      autoSync: true,
      syncInterval: 30000,
    },
    null,
    2
  ) + '\n'
);
console.log('  Created config.json');

// Start QueueFlow.bat
writeFile(
  path.join(USB_OUTPUT, 'Start QueueFlow.bat'),
  '@echo off\r\ncd /d "%~dp0QueueFlow"\r\nstart "" "QueueFlow.exe"\r\n'
);
console.log('  Created Start QueueFlow.bat');

// README.txt for the end user
writeFile(
  path.join(USB_OUTPUT, 'README.txt'),
  `QueueFlow - Portable Queue Management System\r
============================================\r
\r
QUICK START:\r
  Double-click "Start QueueFlow.bat" to launch the application.\r
\r
CONFIGURATION:\r
  Edit "config.json" to configure your Supabase connection:\r
  - supabaseUrl: Your Supabase project URL\r
  - supabaseAnonKey: Your Supabase anon/public key\r
  - offlineOnly: Set to true for fully offline operation\r
\r
OFFLINE MODE:\r
  Leave supabaseUrl empty or set offlineOnly to true.\r
  All data will be stored locally on this USB drive.\r
\r
DATA:\r
  All application data is stored in QueueFlow/data/\r
  This includes the offline database and logs.\r
\r
`
);
console.log('  Created README.txt');

console.log('  Done.\n');

// ─── Step 6: Summary ────────────────────────────────────────────────

// Calculate total size
function getDirSize(dir) {
  let size = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const item of fs.readdirSync(dir)) {
    const itemPath = path.join(dir, item);
    const stat = fs.statSync(itemPath);
    if (stat.isDirectory()) {
      size += getDirSize(itemPath);
    } else {
      size += stat.size;
    }
  }
  return size;
}

const totalSize = getDirSize(USB_OUTPUT);
const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);

console.log('=== Build Complete ===');
console.log(`Output: ${USB_OUTPUT}`);
console.log(`Size: ${sizeMB} MB`);
console.log('');
console.log('Next steps:');
console.log('  1. Edit config.json with your Supabase credentials (or leave empty for offline-only)');
console.log('  2. Copy the entire "usb" folder contents to a USB drive');
console.log('  3. Double-click "Start QueueFlow.bat" to run');
