import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RAW_TOKEN_PATTERNS,
  secret,
  vaultOf,
} from '../lib/secret.mjs';
import {
  checkNoRawSecrets,
} from '../scripts/check-no-raw-secrets.mjs';

function spyRunner(result = { status: 0, stdout: 'FAKE_TOKEN\n', stderr: '' }) {
  const calls = [];
  return {
    calls,
    runner: (argv) => {
      calls.push(argv);
      return result;
    },
  };
}

test('T1 secret rejects raw or malformed values without echoing them', () => {
  for (const value of ['sk-live-1234567890', 'Bearer abcdefghijklmnop', '', null, 'plain-string']) {
    assert.throws(
      () => secret(value, { runner: () => ({ status: 0, stdout: 'x' }) }),
      (error) => error.message.includes('must be an op reference') && !error.message.includes(String(value)),
    );
  }
});

test('T2 secret resolves an op reference through injected array-form op read', () => {
  const spy = spyRunner();
  const value = secret('op://Dev/Postiz API Key/credential', { runner: spy.runner });

  assert.equal(value, 'FAKE_TOKEN');
  assert.deepEqual(spy.calls[0], ['op', 'read', 'op://Dev/Postiz API Key/credential']);
});

test('T2b secret passes op refs with section spaces as one unchanged arg', () => {
  const spy = spyRunner();
  const ref = 'op://Dev/FIRECRAWL_API/add more/jgu53abc';
  const value = secret(ref, { runner: spy.runner });

  assert.equal(value, 'FAKE_TOKEN');
  assert.deepEqual(spy.calls[0], ['op', 'read', ref]);
});

test('T3 secret surfaces op failure without leaking output bytes', () => {
  const spy = spyRunner({ status: 1, stdout: 'SHOULD_NOT_LEAK', stderr: 'auth failed' });

  assert.throws(
    () => secret('op://Dev/Postiz API Key/credential', { runner: spy.runner }),
    (error) =>
      error.message.includes('op read failed for op://Dev/Postiz API Key/credential') &&
      !error.message.includes('SHOULD_NOT_LEAK') &&
      !error.message.includes('auth failed'),
  );
});

test('T4 guard fails on raw token patterns without reporting matched secret text', () => {
  const result = checkNoRawSecrets({
    files: [{ path: 'brands/personal/config.yaml', content: 'postiz_key: sk-live-abcdefghijklmnop\n' }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.findings[0].path, 'brands/personal/config.yaml');
  assert.equal(result.findings[0].line, 1);
  assert.ok(result.findings[0].patternId);
  assert.equal(JSON.stringify(result.findings).includes('sk-live'), false);
});

test('T5 guard passes when only op references appear', () => {
  const result = checkNoRawSecrets({
    files: [{ path: 'brands/personal/config.yaml', content: 'postiz_key: op://Dev/Postiz API Key/credential\n' }],
  });

  assert.deepEqual(result, { ok: true, findings: [] });
});

test('T6 guard covers M1.5 credential shapes', () => {
  const cases = [
    ['generic-api-key', 'api_key: ABCDEFGHIJKLMNOPQRST123456'],
    ['bearer-literal', 'authorization: Bearer abcdefghijklmnopqrstuvwxyz'],
    ['prefixed-newsletter-key', 'newsletter_key: xkey_abcdefghijklmnopqrstuvwxyz'],
    ['ga4-api-secret', 'api_secret: abcdefghijklmnop'],
    ['aws-akia', 'aws: AKIAABCDEFGHIJKLMNOP'],
    ['pem-private-key', '-----BEGIN PRIVATE KEY-----'],
  ];

  for (const [label, content] of cases) {
    const result = checkNoRawSecrets({ files: [{ path: `${label}.yaml`, content }] });
    assert.equal(result.ok, false, label);
  }
  assert.ok(RAW_TOKEN_PATTERNS.length >= cases.length);
});

test('T7 only lib/secret.mjs may invoke op or touch credential env names', async () => {
  const root = new URL('..', import.meta.url);
  const result = checkNoRawSecrets({
    listFiles: () => [
      'lib/secret.mjs',
      'lib/core-schema.mjs',
      'lib/registry.mjs',
      'scripts/check-no-raw-secrets.mjs',
    ],
    readFile: async (file) => readFile(new URL(file, root), 'utf8'),
    boundaryOnly: true,
  });

  assert.deepEqual(result, { ok: true, findings: [] });
});

test('T8 vaultOf validates refs and source keeps array-form spawn without shell mode', async () => {
  assert.equal(vaultOf('op://Dev/Postiz API Key/credential'), 'Dev');
  assert.throws(() => vaultOf('op://Dev'), /at least three segments/);

  const source = await readFile(new URL('../lib/secret.mjs', import.meta.url), 'utf8');
  assert.match(source, /spawnSync\('op', argv\.slice\(1\)/);
  assert.doesNotMatch(source, /shell:\s*true/);
  assert.doesNotMatch(source, /'--vault'/);
});

test('T9 integration guard accepts a clean real-shaped config fixture', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-secret-config-'));
  const configPath = path.join(home, 'config.yaml');
  await writeFile(
    configPath,
    `secrets:
  postiz_api_key: op://Dev/Postiz API Key/credential
  beehiiv_api_key: op://Dev/Newsletter API Key/credential
  ga4_api_secret: op://Dev/GA4 Measurement Secret/credential
  d1_database_token: op://Dev/D1 Database Token/credential
`,
    'utf8',
  );
  try {
    const content = await readFile(configPath, 'utf8');
    assert.equal(checkNoRawSecrets({ files: [{ path: configPath, content }] }).ok, true);
    assert.doesNotMatch(content, /(sk-|Bearer |AKIA|-----BEGIN)/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
