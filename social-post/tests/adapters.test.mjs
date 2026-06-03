import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import * as digest from '../lib/adapters/digest-adapter.mjs';
import * as formatGate from '../lib/adapters/format-gate-adapter.mjs';
import * as prediction from '../lib/adapters/prediction-adapter.mjs';
import { decisionsFile, predictionsDir, today } from '../lib/adapters/adapter-iface.mjs';

async function withSandbox(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'social-adapters-'));
  const configPath = path.join(root, 'config.yaml');
  const config = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/digest-decisions.json
  voice_dir: \${HOME}/Documents/CC Cli/brands/personal/voice
`;
  const previousHome = process.env.HOME;
  const previousSkillDir = process.env.SKILL_DIR;
  const previousConfig = process.env.SOCIAL_POST_CONFIG_PATH;
  const previousBin = process.env.VALIDATE_SOCIAL_POST_BIN;
  process.env.HOME = root;
  process.env.SKILL_DIR = '.claude';
  process.env.SOCIAL_POST_CONFIG_PATH = configPath;
  await writeFile(configPath, config, 'utf8');
  try {
    return await fn(root);
  } finally {
    if (previousHome == null) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousSkillDir == null) delete process.env.SKILL_DIR;
    else process.env.SKILL_DIR = previousSkillDir;
    if (previousConfig == null) delete process.env.SOCIAL_POST_CONFIG_PATH;
    else process.env.SOCIAL_POST_CONFIG_PATH = previousConfig;
    if (previousBin == null) delete process.env.VALIDATE_SOCIAL_POST_BIN;
    else process.env.VALIDATE_SOCIAL_POST_BIN = previousBin;
    await rm(root, { recursive: true, force: true });
  }
}

async function mockGate(root, stdout, exitCode = 0) {
  const file = path.join(root, 'mock-gate.sh');
  await writeFile(file, `#!/bin/sh\nprintf '%s' '${stdout}'\nexit ${exitCode}\n`, 'utf8');
  await chmod(file, 0o755);
  process.env.VALIDATE_SOCIAL_POST_BIN = file;
}

test('T1 prediction append writes social-platform lane records to prediction-distill jsonl', async () => {
  await withSandbox(async () => {
    await prediction.append({ platform: 'facebook', type: 'expected', task_id: 't1', prediction: { tier: 'good' } });
    const file = path.join(predictionsDir(), `${today()}.jsonl`);
    const line = JSON.parse((await readFile(file, 'utf8')).trim());
    assert.equal(line.lane, 'social-facebook');
    assert.equal(line.type, 'expected');
    assert.equal(line.task_id, 't1');
    assert.match(line.ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(typeof line.host, 'string');
    assert.equal(line.prediction.tier, 'good');
  });
});

test('T2 prediction readLane reads matching records and ignores other lanes', async () => {
  await withSandbox(async () => {
    await prediction.append({ platform: 'facebook', type: 'expected', task_id: 'fb' });
    await prediction.append({ platform: 'threads', type: 'expected', task_id: 'th' });
    assert.deepEqual((await prediction.readLane('social-facebook')).map((row) => row.task_id), ['fb']);
    assert.deepEqual(await prediction.readLane('social-linkedin'), []);
  });
});

test('T3 digest record increments category counters and preserves meta', async () => {
  await withSandbox(async () => {
    await mkdir(path.dirname(decisionsFile()), { recursive: true });
    await writeFile(decisionsFile(), JSON.stringify({ _meta: { auto_apply_threshold: 0.8 } }), 'utf8');
    const result = await digest.record('social-voice-facebook', 'reject', { source_proposal_id: 'p1' });
    const decisions = JSON.parse(await readFile(decisionsFile(), 'utf8'));
    assert.deepEqual(decisions._meta, { auto_apply_threshold: 0.8 });
    assert.equal(decisions['social-voice-facebook'].total_proposed, 1);
    assert.equal(decisions['social-voice-facebook'].rejected, 1);
    assert.equal(decisions['social-voice-facebook'].last_decision.source_proposal_id, 'p1');
    assert.deepEqual(result, { applied: false, reason: 'propose-only-M1a' });
  });
});

test('T4 digest adapter cannot auto-apply even on accepted high-confidence proposals', async () => {
  await withSandbox(async () => {
    const result = await digest.record('social-publish-linkedin', 'accept', {
      source_proposal_id: 'p2',
      confidence: 0.99,
      total_proposed: 99,
    });
    assert.deepEqual(result, { applied: false, reason: 'propose-only-M1a' });
    assert.equal(typeof digest.apply, 'undefined');
    assert.equal(typeof digest.autoApply, 'undefined');
  });
});

test('T5 format gate returns script reject reasons without local thresholds', async () => {
  await withSandbox(async (root) => {
    await mockGate(root, '{"status":"fail","reasons":["chars: 900 > 500"]}', 1);
    const post = path.join(root, 'post.md');
    await writeFile(post, 'long post', 'utf8');
    assert.deepEqual(await formatGate.check('threads', post), {
      pass: false,
      reasons: ['chars: 900 > 500'],
      raw: { status: 'fail', reasons: ['chars: 900 > 500'] },
    });
  });
});

test('T6 format gate passes, and fails closed on malformed output', async () => {
  await withSandbox(async (root) => {
    const post = path.join(root, 'post.md');
    await writeFile(post, 'ok', 'utf8');
    await mockGate(root, '{"status":"pass","reasons":[]}', 0);
    assert.deepEqual(await formatGate.check('fb', post), { pass: true, reasons: [], raw: { status: 'pass', reasons: [] } });
    await mockGate(root, 'not-json', 1);
    const result = await formatGate.check('fb', post);
    assert.equal(result.pass, false);
    assert.match(result.reasons[0], /format-gate-error/);
  });
});

test('T7 only adapters may reference upstream substrate paths or scripts', async () => {
  const root = fileURLToPath(new URL('../lib/', import.meta.url));
  const { readdir, readFile: readSource } = await import('node:fs/promises');
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map((entry) => {
      const child = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(child) : child;
    }));
    return files.flat();
  }
  const forbidden = /validate-social-post\.sh|digest-decisions\.json|predictions\//;
  for (const file of await walk(root)) {
    if (file.includes(`${path.sep}adapters${path.sep}`)) continue;
    assert.doesNotMatch(await readSource(file, 'utf8'), forbidden, file);
  }
});

test('T8 integration with real format gate is opt-in', async (t) => {
  if (process.env.RUN_INTEGRATION !== '1') {
    t.skip('set RUN_INTEGRATION=1 to use the real format gate');
    return;
  }
  await withSandbox(async (root) => {
    const post = path.join(root, 'long.md');
    await writeFile(post, 'x'.repeat(2000), 'utf8');
    const result = await formatGate.check('x', post);
    assert.equal(result.pass, false);
    assert.ok(result.reasons.length > 0);
  });
});
