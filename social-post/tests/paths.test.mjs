import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  HardcodedAbsoluteError,
  TrustFileForbiddenError,
  UnresolvedTemplateError,
  assertNoTrustFile,
  expandTemplate,
  loadConfig,
  resolve,
  decisionsFile,
  predictionsDir,
  stateRootInit,
  stateRoot,
} from '../lib/paths.mjs';

const realConfigPath = path.join(os.homedir(), 'Documents/CC Cli/brands/personal/config.yaml');
const homePathLiteralPattern = new RegExp('/(' + ['Users', 'home'].join('|') + ')/|op://');

const goodConfig = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  metrics: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/metrics.jsonl
  inspiration: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/inspiration
  account_health: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/account-health.yaml
  runs: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/runs
  quota_ledger: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/quota-ledger.jsonl
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/digest-decisions.json
  voice_dir: \${HOME}/Documents/CC Cli/brands/personal/voice
model_routing:
  drafting: stub
budgets:
  weekly_usd: 0
fallback_chain:
  publish: []
`;

async function withTempConfig(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-paths-home-'));
  const configPath = path.join(home, 'config.yaml');
  await writeFile(configPath, goodConfig, 'utf8');
  try {
    return await fn({
      configPath,
      env: {
        HOME: home,
        SKILL_DIR: '.claude',
      },
      home,
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test('T1 loadConfig rejects hardcoded absolute path values', async () => {
  await withTempConfig(async ({ configPath }) => {
    const poisonedAbsolute = ['', 'Users', 'example', '.claude', 'state', 'social-evolve', 'facebook', 'metrics.jsonl'].join('/');
    const poisonedConfig = goodConfig.replace('model_routing:', `  poisoned_absolute: ${poisonedAbsolute}\nmodel_routing:`);
    await writeFile(configPath, poisonedConfig, 'utf8');

    assert.throws(() => loadConfig(configPath), HardcodedAbsoluteError);
  });
});

test('T2 resolve expands metrics to the social-evolve platform path', async () => {
  await withTempConfig(({ configPath, env, home }) => {
    assert.equal(
      resolve('metrics', 'facebook', env, configPath).path,
      path.join(home, '.claude/state/social-evolve/facebook/metrics.jsonl'),
    );
  });
});

test('T3 resolve routes predictions to prediction-distill lane outside social-evolve', async () => {
  await withTempConfig(({ configPath, env, home }) => {
    const result = resolve('predictions', 'facebook', env, configPath);

    assert.equal(result.lane, 'social-facebook');
    assert.equal(result.path, path.join(home, '.claude/state/predictions'));
    assert.ok(!result.path.includes('social-evolve'));
    assert.equal(predictionsDir(env, configPath), result.path);
    assert.equal(decisionsFile(env, configPath), path.join(home, '.claude/state/digest-decisions.json'));
    assert.equal(stateRoot(env, configPath), path.join(home, '.claude/state/social-evolve'));
  });
});

test('T4 resolve throws when platform template remains unresolved', async () => {
  await withTempConfig(({ configPath, env }) => {
    assert.throws(
      () => resolve('metrics', undefined, env, configPath),
      (error) =>
        error instanceof UnresolvedTemplateError &&
        error.message.includes('unresolved template var ${platform}'),
    );
  });
});

test('T5 stateRootInit creates one root and platform subdirs idempotently', async () => {
  await withTempConfig(async ({ configPath, env, home }) => {
    const first = await stateRootInit('facebook', env, configPath);
    const second = await stateRootInit('facebook', env, configPath);

    assert.equal(first, path.join(home, '.claude/state/social-evolve'));
    assert.equal(second, first);
    assert.ok(existsSync(first));
    assert.ok(existsSync(path.join(first, 'facebook/inspiration/_raw')));
    assert.ok(existsSync(path.join(first, 'facebook/runs')));
    assert.ok(existsSync(path.join(first, 'facebook/assets')));
    assert.ok(!existsSync(path.join(first, 'social-evolve')));
  });
});

test('T6 stateRootInit never creates trust.yaml and assertNoTrustFile rejects planted trust file', async () => {
  await withTempConfig(async ({ configPath, env }) => {
    const root = await stateRootInit('facebook', env, configPath);
    const trustPath = path.join(root, 'facebook/evolution/trust.yaml');

    assert.equal(existsSync(trustPath), false);
    await writeFile(trustPath, 'trust: forbidden\n', { flag: 'wx' }).catch(async (error) => {
      if (error.code !== 'ENOENT') throw error;
      await import('node:fs/promises').then(({ mkdir }) =>
        mkdir(path.dirname(trustPath), { recursive: true }),
      );
      await writeFile(trustPath, 'trust: forbidden\n', { flag: 'wx' });
    });
    assert.throws(() => assertNoTrustFile(path.join(root, 'facebook')), TrustFileForbiddenError);
  });
});

test('T7 expandTemplate is pure and rejects unresolved variables', () => {
  const vars = Object.freeze({ HOME: '/a' });

  assert.equal(expandTemplate('${HOME}/x', vars), '/a/x');
  assert.deepEqual(vars, { HOME: '/a' });
  assert.throws(
    () => expandTemplate('${HOME}/${platform}', vars),
    (error) =>
      error instanceof UnresolvedTemplateError &&
      error.message.includes('unresolved template var ${platform}'),
  );
});

test('T8 real config has no hardcoded paths, home literals, or op secrets', async () => {
  const content = await readFile(realConfigPath, 'utf8');

  assert.doesNotMatch(content, homePathLiteralPattern);
});

test('T9 real config reuses prediction-distill state locations', () => {
  assert.equal(resolve('predictions', 'facebook').path, path.join(os.homedir(), '.claude/state/predictions'));
  assert.equal(resolve('predictions', 'facebook').lane, 'social-facebook');
  assert.equal(resolve('decisions').path, path.join(os.homedir(), '.claude/state/digest-decisions.json'));
});
