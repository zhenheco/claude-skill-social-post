import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as migration from '../scripts/migrate-brand.mjs';
import * as core from '../lib/core-schema.mjs';
import * as voice from '../lib/voice-schema.mjs';
import { parse } from '../lib/yaml.mjs';

const { migrate } = migration;
const realBrandPath = path.join(os.homedir(), 'Documents/CC Cli/brands/personal/brand.yaml');

async function withFixtureVault(fn) {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), 'migrate-brand-'));
  const source = await readFile(realBrandPath, 'utf8');
  await writeFile(path.join(vaultRoot, 'brand.yaml'), source, 'utf8');
  try {
    return await fn(vaultRoot, source);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
}

async function readVoice(vaultRoot, platform) {
  return parse(await readFile(path.join(vaultRoot, 'voice', `${platform}.yaml`), 'utf8'));
}

async function snapshotTree(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const result = {};
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      Object.assign(result, await snapshotTree(root, fullPath));
    } else {
      result[path.relative(root, fullPath)] = await readFile(fullPath, 'utf8');
    }
  }
  return result;
}

test('T1 migration produces valid core.yaml and five valid voice files', async () => {
  await withFixtureVault(async (vaultRoot) => {
    const result = await migrate({ vaultRoot });

    assert.equal(result.noop, false);
    assert.equal((await core.validate(path.join(vaultRoot, 'core.yaml'))).valid, true);
    for (const platform of voice.PLATFORMS) {
      const file = path.join(vaultRoot, 'voice', `${platform}.yaml`);
      assert.equal(existsSync(file), true);
      assert.equal(voice.validateVoiceFile(await readVoice(vaultRoot, platform), { platform }).ok, true);
    }
    assert.deepEqual(voice.PLATFORMS, ['facebook', 'instagram', 'threads', 'x', 'linkedin']);
  });
});

test('T6 invalid produced voice aborts before writing split files', async () => {
  await withFixtureVault(async (vaultRoot) => {
    await assert.rejects(
      migrate({
        vaultRoot,
        transformVoice: (platform, payload) => {
          if (platform === 'facebook') delete payload.version;
          return payload;
        },
      }),
      /Migration aborted/,
    );

    assert.equal(existsSync(path.join(vaultRoot, 'core.yaml')), false);
    assert.equal(existsSync(path.join(vaultRoot, 'voice')), false);
    const backups = await readdir(vaultRoot);
    assert.equal(backups.filter((entry) => entry.startsWith('brand.yaml.bak-')).length, 1);
  });
});

test('T2 user_custom is preserved byte-for-byte and recorded in core', async () => {
  await withFixtureVault(async (vaultRoot, source) => {
    const expected = migration.preserveUserCustom(source);
    const result = await migrate({ vaultRoot });
    const preserved = await readFile(path.join(vaultRoot, '.user_custom.preserved'), 'utf8');
    const loadedCore = await core.loadCore(path.join(vaultRoot, 'core.yaml'));

    assert.equal(result.userCustomSha256, expected.sha256);
    assert.equal(loadedCore.raw().user_custom_sha256, expected.sha256);
    assert.equal(preserved, expected.bytes);
  });
});

test('T3 write-ban guard rejects user_custom and core.yaml target writes', async () => {
  await withFixtureVault(async (vaultRoot) => {
    const writeBans = ['user_custom', 'core.yaml'];

    assert.throws(
      () => migration.assertNoUserCustomWrite([path.join(vaultRoot, 'core.yaml')], writeBans),
      /write-ban/,
    );
    assert.throws(
      () => migration.assertNoUserCustomWrite(['user_custom'], writeBans),
      /write-ban/,
    );
    assert.doesNotThrow(() =>
      migration.assertNoUserCustomWrite([path.join(vaultRoot, 'voice', 'facebook.yaml')], writeBans),
    );
  });
});

test('T5 brand.yaml is backed up byte-identically before produced files are built', async () => {
  await withFixtureVault(async (vaultRoot, source) => {
    const now = new Date('2026-06-03T00:00:00.000Z');
    let observedBackup;

    const result = await migrate({
      vaultRoot,
      now,
      transformVoice: (platform, payload) => {
        if (platform === 'facebook') {
          observedBackup = path.join(vaultRoot, 'brand.yaml.bak-2026-06-03T00-00-00-000Z');
          assert.equal(existsSync(observedBackup), true);
        }
        return payload;
      },
    });

    assert.equal(result.backupPath, observedBackup);
    assert.equal(await readFile(observedBackup, 'utf8'), source);
    assert.equal(existsSync(observedBackup), true);
  });
});

test('T4 second run on a valid split tree is a no-op with zero diff', async () => {
  await withFixtureVault(async (vaultRoot) => {
    const first = await migrate({ vaultRoot, now: new Date('2026-06-03T00:00:00.000Z') });
    const before = await snapshotTree(vaultRoot);
    const second = await migrate({ vaultRoot, now: new Date('2026-06-03T00:00:01.000Z') });
    const after = await snapshotTree(vaultRoot);

    assert.equal(first.noop, false);
    assert.equal(second.noop, true);
    assert.deepEqual(after, before);
    assert.equal(Object.keys(after).filter((file) => file.startsWith('brand.yaml.bak-')).length, 1);
    assert.equal(second.userCustomSha256, first.userCustomSha256);
  });
});

test('T7 migration source has no hardcoded home paths and writes stay in vault', async () => {
  await withFixtureVault(async (vaultRoot) => {
    await migrate({ vaultRoot });
    const scriptSource = await readFile(new URL('../scripts/migrate-brand.mjs', import.meta.url), 'utf8');
    const testSource = await readFile(new URL('./migrate-brand.test.mjs', import.meta.url), 'utf8');
    const forbiddenHomeLiteral = new RegExp('/' + ['Users', 'home'].join('/|/') + '/');
    const files = Object.keys(await snapshotTree(vaultRoot));

    assert.doesNotMatch(scriptSource, forbiddenHomeLiteral);
    assert.doesNotMatch(testSource, forbiddenHomeLiteral);
    assert.ok(files.every((file) => !file.split(path.sep).includes('..')));
  });
});

test('T8 produced core keeps propose-only automation flags and validator rejects flips', async () => {
  await withFixtureVault(async (vaultRoot) => {
    await migrate({ vaultRoot });
    const corePath = path.join(vaultRoot, 'core.yaml');
    const loadedCore = await core.loadCore(corePath);
    const policy = loadedCore.automationPolicy();

    assert.equal(policy.auto_send, false);
    assert.equal(policy.browser_posting, false);
    assert.equal(policy.trust_graduation, false);
    assert.equal(policy.mode, 'propose_only');

    const flippedPath = path.join(vaultRoot, 'core-flipped.yaml');
    const flipped = (await readFile(corePath, 'utf8')).replace('auto_send: false', 'auto_send: true');
    await writeFile(flippedPath, flipped, 'utf8');
    const result = await core.validate(flippedPath);

    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /auto_send/);
  });
});
