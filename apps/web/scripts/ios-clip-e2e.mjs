#!/usr/bin/env node

import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..', '..');
const webDir = path.resolve(__dirname, '..');
const statePathPrimary = path.resolve(rootDir, '.tmp', 'ios-push-test.json');
const statePathFallback = path.resolve(os.tmpdir(), 'qflow', 'ios-push-test.json');
const statePathCandidates = [statePathPrimary, statePathFallback];
const lastStatePrimary = path.resolve(rootDir, '.tmp', 'ios-push-test-last.json');
const lastStateFallback = path.resolve(os.tmpdir(), 'qflow', 'ios-push-test-last.json');
const iosDir = path.resolve(rootDir, 'apps', 'ios', 'QueueFlow');
const projectPath = path.resolve(iosDir, 'QueueFlow.xcodeproj');
const derivedDataPath = path.resolve(rootDir, '.tmp', 'xcodebuild-queueflow-clip');
const scheme = 'QueueFlowClip';
const xcodeAppProcessPattern = '/Applications/Xcode.app/Contents/MacOS/Xcode';
const appClipBundleId = 'com.queueflow.app.QueueFlowClip';
const fullAppBundleId = 'com.queueflow.app';

const DEFAULT_WAIT_AFTER_OPEN_MS = 8000;

function parseArg(name, fallback = undefined) {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) {
    return exact.slice(name.length + 1);
  }

  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }

  return fallback;
}

function boolArg(name) {
  return process.argv.includes(name);
}

function run(command, options = {}) {
  const safeCommand = options.log ?? command;
  console.log(`$ ${safeCommand}`);
  return execSync(command, {
    cwd: options.cwd ?? webDir,
    stdio: 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    shell: '/bin/zsh',
  });
}

function runCapture(command, options = {}) {
  const output = execSync(command, {
    cwd: options.cwd ?? webDir,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    shell: '/bin/zsh',
  });

  return output.toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freshStartEnvironment(resolvedDestination) {
  console.log('Preparing fresh iOS test environment...');

  try {
    run(`osascript -e 'tell application "Xcode" to if it is running then quit'`, {
      cwd: webDir,
    });
  } catch {
    // Ignore if Xcode is not running or AppleScript fails.
  }

  await sleep(1500);

  try {
    const remaining = runCapture(`pgrep -f ${JSON.stringify(xcodeAppProcessPattern)}`, {
      cwd: webDir,
    }).trim();

    if (remaining) {
      run(`pkill -f ${JSON.stringify(xcodeAppProcessPattern)}`, {
        cwd: webDir,
      });
      await sleep(1000);
    }
  } catch {
    // No remaining Xcode app process.
  }

  await rm(derivedDataPath, { recursive: true, force: true });
  await mkdir(derivedDataPath, { recursive: true });

  if (!resolvedDestination?.isSimulator) {
    const deviceId = resolvedDestination.destination.replace(/^platform=iOS,id=/, '');
    try {
      run(
        `xcrun devicectl device uninstall app --device ${deviceId} ${appClipBundleId}`,
        { cwd: webDir }
      );
    } catch {
      // Ignore if the App Clip is not currently installed.
    }

    try {
      run(
        `xcrun devicectl device uninstall app --device ${deviceId} ${fullAppBundleId}`,
        { cwd: webDir }
      );
    } catch {
      // Ignore if the full app is not currently installed.
    }
  }
}

async function readTicketState() {
  for (const statePath of statePathCandidates) {
    try {
      const raw = await readFile(statePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      // Keep trying fallback.
    }
  }
  throw new Error(`No test state file found in: ${statePathCandidates.join(', ')}`);
}

async function writeStateWithFallback(filePath, fallbackFilePath, data) {
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
    return;
  } catch (error) {
    if (error?.code !== 'ENOSPC' && error?.code !== 'EROFS' && error?.code !== 'EACCES') {
      throw error;
    }
    await mkdir(path.dirname(fallbackFilePath), { recursive: true });
    await writeFile(fallbackFilePath, data);
  }
}

function findBootedOrFirstSimulatorId() {
  try {
    const output = runCapture('xcrun simctl list devices --json', { cwd: webDir });
    const parsed = JSON.parse(output);
    const allSimulators = Object.values(parsed.devices || {}).flatMap((bucket) => bucket || []);
    const booted = allSimulators.find((sim) => sim.state === 'Booted');
    if (booted?.udid) {
      return booted.udid;
    }

    return allSimulators.find((sim) => /^iPhone /i.test(sim.name || '') && sim.udid)?.udid ?? null;
  } catch {
    return null;
  }
}

async function findConnectedDeviceId() {
  const outputFile = path.resolve(os.tmpdir(), 'qflow', 'queueflow-device-list.json');
  await mkdir(path.dirname(outputFile), { recursive: true });

  try {
    runCapture(`xcrun devicectl list devices --json-output ${outputFile} --quiet`, {
      cwd: webDir,
    });

    const data = JSON.parse(await readFile(outputFile, 'utf8'));
    const devices = data?.result?.devices || [];
    const connected = devices.find((device) => {
      const props = device.connectionProperties || {};
      return props.pairingState === 'paired' || props.tunnelState === 'connected';
    });

    if (!connected) {
      return null;
    }

    return (
      connected.hardwareProperties?.udid ||
      connected.identifier ||
      connected.connectionProperties?.localHostnames?.find((value) => /^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/i.test(value)) ||
      null
    );
  } catch {
    return null;
  }
}

async function getDestination() {
  const customDestination = parseArg('--destination');
  if (customDestination) {
    const isSimulator = customDestination.startsWith('id=') && !customDestination.includes('platform=iOS,');
    return { destination: customDestination, isSimulator };
  }

  const deviceId = parseArg('--device-id');
  if (deviceId) {
    return { destination: `platform=iOS,id=${deviceId}`, isSimulator: false };
  }

  const simulatorId = parseArg('--simulator-id');
  if (simulatorId) {
    return { destination: `id=${simulatorId}`, isSimulator: true };
  }

  if (boolArg('--simulator')) {
    const selected = findBootedOrFirstSimulatorId();
    if (!selected) {
      throw new Error('No simulators found. Pass --simulator-id or use --device-id for a physical device.');
    }

    return { destination: `id=${selected}`, isSimulator: true };
  }

  const autoDeviceId = await findConnectedDeviceId();
  if (autoDeviceId) {
    return { destination: `platform=iOS,id=${autoDeviceId}`, isSimulator: false, deviceId: autoDeviceId };
  }

  const autoSimId = findBootedOrFirstSimulatorId();
  if (autoSimId) {
    return { destination: `id=${autoSimId}`, isSimulator: true, simulatorId: autoSimId };
  }

  return null;
}

async function openOnDeviceOrSimulator(destination, ticketURL, isSimulator) {
  if (isSimulator) {
    const simId = destination.replace(/^id=/, '');
    run(`xcrun simctl openurl ${simId} "${ticketURL}"`, { cwd: webDir });
    return;
  }

  const deviceId = destination.replace(/^platform=iOS,id=/, '');
  try {
    run(
      `xcrun devicectl device process launch --device ${deviceId} --terminate-existing com.apple.mobilesafari --payload-url ${JSON.stringify(ticketURL)}`,
      {
        cwd: webDir,
      }
    );
  } catch (error) {
    console.log('Could not auto-launch URL on device. Open this URL manually on the phone:');
    console.log(ticketURL);
    console.error(error instanceof Error ? error.message : String(error));
  }
}

function printUsage() {
  console.log(`Usage:
  pnpm --filter @queueflow/web ios:clip-e2e

Recommended:
  pnpm --filter @queueflow/web ios:clip-e2e:auto
  pnpm --filter @queueflow/web ios:clip-call-again

Optional flags:
  --device-id <UDID>           Use specific device for install + launch
  --simulator-id <UDID>        Use specific simulator
  --simulator                  Use first available simulator
  --destination "platform=iOS,id=<id>"  Xcode destination override
  --no-fresh                   Skip the default fresh cleanup before install
  --open-xcode                 Open QueueFlow.xcodeproj before build/install
  --wait-ms <ms>               Delay before send step (default: ${DEFAULT_WAIT_AFTER_OPEN_MS})
  --open-url-only              Stop after URL launch
  --call-only                  Skip install/open and only send call for the latest ticket
  --title "<text>"              Title for call-only follow-up
  --body "<text>"               Body for call-only follow-up
`);
}

async function main() {
  if (boolArg('--help') || boolArg('-h')) {
    printUsage();
    return;
  }

  if (boolArg('--call-only')) {
    const title = parseArg('--title');
    const body = parseArg('--body');
    let command = 'node scripts/ios-push-test.mjs call';
    if (title) {
      command += ` --title ${JSON.stringify(title)}`;
    }
    if (body) {
      command += ` --body ${JSON.stringify(body)}`;
    }

    run(command, { cwd: webDir });
    return;
  }

  const resolvedDestination = await getDestination();
  if (!resolvedDestination) {
    throw new Error('No device available. Use --device-id, --simulator-id, or --simulator.');
  }

  const noSend = boolArg('--open-url-only');
  const freshStart = !boolArg('--no-fresh');
  const openXcode = boolArg('--open-xcode');
  const waitMs = Number(parseArg('--wait-ms', `${DEFAULT_WAIT_AFTER_OPEN_MS}`)) || DEFAULT_WAIT_AFTER_OPEN_MS;

  if (freshStart) {
    await freshStartEnvironment(resolvedDestination);
  }

  run('node scripts/ios-push-test.mjs create', { cwd: webDir });
  const state = await readTicketState();

  const destination = resolvedDestination.destination;
  const isSimulator = Boolean(resolvedDestination.isSimulator);

  if (openXcode) {
    run(`open -a Xcode "${projectPath}"`);
  }

  run(
    `xcodebuild -project "${projectPath}" -scheme ${scheme} -configuration Debug -destination '${destination}' -derivedDataPath ${derivedDataPath} -allowProvisioningUpdates install`,
    {
      cwd: iosDir,
    }
  );

  await openOnDeviceOrSimulator(destination, state.ticketURL, isSimulator);

  if (noSend) {
    console.log('Open-url-only flag set. Run the next command when you want to send:');
    console.log('pnpm --filter @queueflow/web ios:push-test call');
    return;
  }

  console.log(`Waiting ${waitMs}ms for token registration...`);
  await sleep(waitMs);

  run('node scripts/ios-push-test.mjs call', { cwd: webDir });

  await writeStateWithFallback(
    lastStatePrimary,
    lastStateFallback,
    JSON.stringify({ ...state, automatedAt: new Date().toISOString() }, null, 2)
  );

  console.log('Done.');
  console.log(`Ticket: ${state.ticketNumber}`);
  console.log(`URL: ${state.ticketURL}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  printUsage();
  process.exit(1);
});
