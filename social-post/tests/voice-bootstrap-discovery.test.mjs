import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  SOCIAL_PLATFORMS,
  discoverSocialSources,
} from '../lib/voice-bootstrap/discovery.mjs';
import { parse } from '../lib/yaml.mjs';

const configText = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  inspiration: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/inspiration
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/decisions-store.json
  voice_dir: \${HOME}/brands/personal/voice
`;

async function withDiscoverySandbox(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'voice-discovery-'));
  const configPath = path.join(home, 'config.yaml');
  const env = { HOME: home, SKILL_DIR: '.claude', SOCIAL_POST_CONFIG_PATH: configPath };
  await writeFile(configPath, configText, 'utf8');
  try {
    return await fn({ home, env, configPath });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function fileNames(dir) {
  try {
    return await readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

test('discoverSocialSources writes only five social source registries and no raw copy', async () => {
  await withDiscoverySandbox(async ({ home, env, configPath }) => {
    assert.deepEqual(SOCIAL_PLATFORMS, ['facebook', 'instagram', 'threads', 'x', 'linkedin']);

    const result = await discoverSocialSources({ env, configPath, now: '2026-06-04T12:00:00.000Z' });

    assert.deepEqual(result.platforms.toSorted(), SOCIAL_PLATFORMS.toSorted());
    for (const platform of SOCIAL_PLATFORMS) {
      const dir = path.join(home, `.claude/state/social-evolve/${platform}/inspiration`);
      const sources = parse(await import('node:fs/promises').then(({ readFile }) => readFile(path.join(dir, 'sources.yaml'), 'utf8'))).sources;
      assert.equal(sources.length >= 3, true, platform);
      assert.equal((await fileNames(path.join(dir, '_raw'))).length, 0);
      assert.equal(sources.every((source) => source.niche_tags.includes('ai') && source.discovered_at === '2026-06-04T12:00:00.000Z'), true);
    }
  });
});

test('native login-wall social platforms default to owner_paste candidates', async () => {
  await withDiscoverySandbox(async ({ home, env, configPath }) => {
    await discoverSocialSources({ platform: 'linkedin', env, configPath, now: '2026-06-04T12:00:00.000Z' });
    await discoverSocialSources({ platform: 'instagram', env, configPath, now: '2026-06-04T12:00:00.000Z' });
    await discoverSocialSources({ platform: 'x', env, configPath, now: '2026-06-04T12:00:00.000Z' });

    for (const platform of ['linkedin', 'instagram', 'x']) {
      const file = path.join(home, `.claude/state/social-evolve/${platform}/inspiration/sources.yaml`);
      const sources = parse(await import('node:fs/promises').then(({ readFile }) => readFile(file, 'utf8'))).sources;
      assert.equal(sources.every((source) => source.access_mode === 'owner_paste'), true, platform);
    }
  });
});
