import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function readEnvFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const env = {};

  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#')) {
      continue;
    }

    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    env[key] = rawValue;
  }

  const keyMatch = text.match(/APNS_KEY_P8="([\s\S]*?)"/);
  if (keyMatch) {
    env.APNS_KEY_P8 = keyMatch[1];
  }

  return env;
}

function trimWrapped(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function reportFromEnv(env) {
  const keyId = trimWrapped(env.APNS_KEY_ID);
  const teamId = trimWrapped(env.APNS_TEAM_ID);
  const bundleId = trimWrapped(env.APNS_BUNDLE_ID) || 'com.queueflow.app.QueueFlowClip';
  const rawPem = trimWrapped(env.APNS_KEY_P8);

  if (!rawPem) {
    throw new Error('APNS_KEY_P8 not found');
  }

  const pem = rawPem.replace(/\\n/g, '\n').trim();
  const privateKey = crypto.createPrivateKey(pem);
  const publicKeyPem = crypto.createPublicKey(privateKey).export({
    type: 'spki',
    format: 'pem',
  });
  const fingerprint = crypto
    .createHash('sha256')
    .update(publicKeyPem)
    .digest('hex');

  console.log('APNS_TEAM_ID=', teamId);
  console.log('APNS_KEY_ID=', keyId);
  console.log('APNS_BUNDLE_ID=', bundleId);
  console.log('APNS_PUBLIC_KEY_SHA256=', fingerprint);
}

const envPath = path.resolve(process.cwd(), 'apps/web/.env.local');
reportFromEnv(readEnvFile(envPath));
