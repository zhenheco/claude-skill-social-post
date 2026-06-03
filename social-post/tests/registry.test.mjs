import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  EXCLUDE_LIST,
  ExcludedPlatformError,
  UnknownPlatformError,
  accessModeFor,
  assertAllowed,
  is_excluded,
  loadRegistry,
  mechanismFor,
  register,
  scaffold,
} from '../lib/registry.mjs';

const homePathLiteralPattern = new RegExp('/(' + ['Users', 'home'].join('|') + ')/');
const opSchemePattern = new RegExp(['op', ':', '/', '/'].join(''));
const tokenLiteralPattern = new RegExp(['sk-', 'Bearer ', 'AKIA', 'BEGIN PRIVATE KEY'].join('|'));

const configFixture = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/digest-decisions.json
  voice_dir: \${HOME}/Documents/CC Cli/brands/personal/voice
platform_registry:
  facebook:
    access_mode: broadcast
    posting_mechanism: browser_attended_draft_1click
    language_stack: zh
  instagram:
    access_mode: broadcast
    posting_mechanism: browser_attended_draft_1click
    language_stack: zh
  threads:
    access_mode: broadcast
    posting_mechanism: browser_attended_draft_1click
    language_stack: zh
  linkedin:
    access_mode: official_api
    posting_mechanism: postiz_official_api
    language_stack: en
  x:
    access_mode: official_api
    posting_mechanism: postiz_official_api
    language_stack: en
  beehiiv:
    access_mode: owned
    posting_mechanism: beehiiv_api_human_send
    language_stack: en
  vocus:
    access_mode: owned
    posting_mechanism: vocus_publish_adapter_1click
    language_stack: zh
  devto:
    access_mode: owned
    posting_mechanism: devto_canonical_spoke
    language_stack: en
`;

async function withRegistryConfig(content, fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-registry-'));
  const configPath = path.join(home, 'config.yaml');
  const auditPath = path.join(home, 'registry-audit.jsonl');
  const env = {
    HOME: home,
    SKILL_DIR: '.claude',
    SOCIAL_POST_CONFIG_PATH: configPath,
    SOCIAL_REGISTRY_AUDIT_LOG: auditPath,
  };
  await writeFile(configPath, content, 'utf8');
  try {
    return await fn({ home, configPath, auditPath, env });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test('T1 is_excluded blocks canonical PRC platforms', () => {
  assert.equal(is_excluded('知乎'), true);
  assert.equal(is_excluded('小紅書'), true);
  assert.equal(is_excluded('即刻'), true);
});

test('T2 is_excluded blocks aliases and simplified names', () => {
  for (const name of ['xiaohongshu', 'xhs', 'rednote', '小红书', 'zhihu', 'jike']) {
    assert.equal(is_excluded(name), true, name);
  }
});

test('T3 is_excluded allows registered non-PRC surfaces', () => {
  assert.equal(is_excluded('facebook'), false);
  assert.equal(is_excluded('beehiiv'), false);
});

test('T4 scaffold, register, and assertAllowed throw for excluded platforms', async () => {
  await withRegistryConfig(configFixture, ({ env }) => {
    assert.throws(() => scaffold('小紅書', { env }), ExcludedPlatformError);
    assert.throws(() => register('知乎', { env }), ExcludedPlatformError);
    assert.throws(() => assertAllowed('即刻', { env }), ExcludedPlatformError);
  });
});

test('T5 excluded scaffold writes traceable audit JSON', async () => {
  await withRegistryConfig(configFixture, async ({ env, auditPath }) => {
    assert.throws(() => scaffold('小紅書', { env }), ExcludedPlatformError);
    const records = (await readFile(auditPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

    assert.equal(records.length, 1);
    assert.equal(records[0].platform, '小紅書');
    assert.equal(records[0].reason, 'hard-exclude');
    assert.equal(records[0].caller, 'scaffold');
    assert.match(records[0].ts, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test('T6 loadRegistry validates the seeded registry shape', async () => {
  await withRegistryConfig(configFixture, ({ env, configPath }) => {
    const registry = loadRegistry({ env, configPath });
    const expected = ['facebook', 'instagram', 'threads', 'linkedin', 'x', 'beehiiv', 'vocus', 'devto'];

    assert.deepEqual(Object.keys(registry).sort(), expected.sort());
    for (const platform of expected) {
      assert.ok(['owned', 'official_api', 'broadcast'].includes(registry[platform].access_mode));
      assert.ok(registry[platform].posting_mechanism.length > 0);
    }
    assert.equal(registry.linkedin.access_mode, 'official_api');
    assert.equal(registry.x.access_mode, 'official_api');
    assert.equal(registry.beehiiv.access_mode, 'owned');
    assert.equal(registry.vocus.access_mode, 'owned');
    assert.equal(registry.devto.access_mode, 'owned');
    assert.equal(Object.isFrozen(registry), true);
    assert.equal(Object.isFrozen(registry.facebook), true);
  });
});

test('T7 config cannot override or add excluded platforms', async () => {
  const poisoned = configFixture.replace(
    '  devto:\n',
    `  小紅書:
    access_mode: owned
    posting_mechanism: forbidden
    language_stack: zh
  devto:
`,
  ) + `exclude_list: []
exclude_list_overrides:
  即刻: allow
`;
  await withRegistryConfig(poisoned, async ({ env, configPath, auditPath }) => {
    const registry = loadRegistry({ env, configPath });
    const records = (await readFile(auditPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

    assert.equal(is_excluded('即刻'), true);
    assert.equal(registry['小紅書'], undefined);
    assert.equal(records.some((record) => record.platform === '小紅書' && record.reason === 'hard-exclude'), true);
  });
});

test('T8 EXCLUDE_LIST is frozen', () => {
  assert.equal(Object.isFrozen(EXCLUDE_LIST), true);
  assert.throws(() => EXCLUDE_LIST.push('forbidden'), TypeError);
});

test('T9 mechanism and access-mode lookups fail closed', async () => {
  await withRegistryConfig(configFixture, ({ env, configPath }) => {
    assert.equal(mechanismFor('linkedin', { env, configPath }), 'postiz_official_api');
    assert.equal(accessModeFor('beehiiv', { env, configPath }), 'owned');
    assert.throws(() => mechanismFor('小紅書', { env, configPath }), ExcludedPlatformError);
    assert.throws(() => mechanismFor('tiktok', { env, configPath }), UnknownPlatformError);
  });
});

test('T10 bad registry enum fails closed', async () => {
  const bad = configFixture.replace('access_mode: broadcast', 'access_mode: auto_send');
  await withRegistryConfig(bad, ({ env, configPath }) => {
    assert.throws(
      () => loadRegistry({ env, configPath }),
      (error) => error.message.includes('facebook') && error.message.includes('auto_send'),
    );
  });
});

test('T11 registry source has clean paths and no secret literals', async () => {
  const source = await readFile(new URL('../lib/registry.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, homePathLiteralPattern);
  assert.doesNotMatch(source, opSchemePattern);
  assert.doesNotMatch(source, tokenLiteralPattern);
});
