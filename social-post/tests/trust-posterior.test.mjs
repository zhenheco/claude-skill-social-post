import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolve } from '../lib/paths.mjs';
import {
  apply,
  graduate,
  loadPosterior,
  preview_delta,
  update,
  wouldGraduate,
} from '../lib/trust-posterior.mjs';

const config = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  metrics: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/metrics.jsonl
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/digest-decisions.json
  voice_dir: \${HOME}/Documents/CC Cli/brands/personal/voice
`;

async function withSandbox(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-trust-'));
  const configPath = path.join(home, 'config.yaml');
  const env = { HOME: home, SKILL_DIR: '.claude' };
  await writeFile(configPath, config, 'utf8');
  try {
    return await fn({ home, configPath, env });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function trustFile(ctx, platform = 'facebook') {
  return path.join(resolve('state_root', platform, ctx.env, ctx.configPath).path, platform, 'trust-posterior.json');
}

function scanFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? scanFiles(full) : [full];
  });
}

test('loads seeded structured posterior dimensions separately', async () => {
  await withSandbox(async (ctx) => {
    const formula = await loadPosterior('facebook', 'formula_trust', ctx);
    const voice = await loadPosterior('facebook', 'voice_trust', ctx);

    assert.deepEqual(Object.keys(formula).sort(), [
      'decay_ts',
      'evidence_ids',
      'failures',
      'last_step_ts',
      'lower_bound',
      'prior_alpha',
      'prior_beta',
      'successes',
    ]);
    assert.equal(formula.successes, 0);
    assert.equal(formula.failures, 0);
    assert.deepEqual(formula.evidence_ids, []);
    assert.notStrictEqual(formula, voice);
  });
});

test('updates and persists one dimension without collapsing other posteriors', async () => {
  await withSandbox(async (ctx) => {
    const updated = await update('facebook', 'engagement-quality', { verdict: 'win' }, 'e1', { ...ctx, now: '2026-06-03T00:00:00.000Z' });
    const file = trustFile(ctx);
    const stored = JSON.parse(await readFile(file, 'utf8'));

    assert.equal(updated.successes, 1);
    assert.equal(updated.failures, 0);
    assert.deepEqual(updated.evidence_ids, ['e1']);
    assert.equal(stored.dimensions['engagement-quality'].successes, 1);
    assert.equal(stored.dimensions.distribution.successes, 0);
    assert.equal(stored.dimensions['conversion-proxy'].successes, 0);
  });
});

test('publish_trust only rises on proper scoring rule beating baseline', async () => {
  await withSandbox(async (ctx) => {
    const voiceEdit = await update('facebook', 'publish_trust', {
      verdict: 'win',
      source: 'accepted_voice_edit',
    }, 'bad', ctx);
    const scored = await update('facebook', 'publish_trust', {
      verdict: 'win',
      source: 'proper_scoring_rule',
      brier_convert: 0.12,
      baseline_brier_convert: 0.25,
    }, 'good', ctx);

    assert.equal(voiceEdit.successes, 0);
    assert.deepEqual(voiceEdit.evidence_ids, []);
    assert.equal(scored.successes, 1);
    assert.deepEqual(scored.evidence_ids, ['good']);
  });
});

test('reply_trust records draft quality evidence only', async () => {
  await withSandbox(async (ctx) => {
    const ignored = await update('facebook', 'reply_trust', { verdict: 'win', sent: true }, 'send', ctx);
    const quality = await update('facebook', 'reply_trust', { draft_quality: 'pass' }, 'draft', ctx);

    assert.equal(ignored.successes, 0);
    assert.equal(quality.successes, 1);
    assert.deepEqual(quality.evidence_ids, ['draft']);
  });
});

test('preview delta is non-mutating and enforces window, cap, decay, and cooldown gates', async () => {
  await withSandbox(async (ctx) => {
    for (let index = 0; index < 21; index += 1) {
      const id = `e${index}`;
      await update('facebook', 'formula_trust', { verdict: 'win' }, id, { ...ctx, now: '2026-05-01T00:00:00.000Z' });
    }
    const oneWindow = await preview_delta('facebook', 'formula_trust', { ...ctx, maturedWindows: 1, now: '2026-06-03T00:00:00.000Z' });
    assert.deepEqual(oneWindow, { eligible: false, reason: 'needs 2 consecutive matured windows' });

    const before = readFileSync(trustFile(ctx), 'utf8');
    const eligible = await preview_delta('facebook', 'formula_trust', { ...ctx, maturedWindows: 2, now: '2026-06-03T00:00:00.000Z' });
    const after = readFileSync(trustFile(ctx), 'utf8');
    assert.equal(after, before);
    assert.equal(eligible.eligible, true);
    assert.ok(Math.abs(eligible.delta) <= 0.05);
    assert.equal(eligible.ewma_applied, true);

    await update('facebook', 'formula_trust', { verdict: 'loss' }, 'cooldown', { ...ctx, now: '2026-05-28T00:00:00.000Z' });
    const rateLimited = await preview_delta('facebook', 'formula_trust', { ...ctx, maturedWindows: 2, now: '2026-06-03T00:00:00.000Z' });
    assert.deepEqual(rateLimited, { eligible: false, reason: 'rate-limited <2wk + cooldown' });
  });
});

test('graduation and apply paths are guarded off for M1a', async () => {
  await withSandbox(async (ctx) => {
    const posterior = await loadPosterior('facebook', 'formula_trust', ctx);

    assert.equal(wouldGraduate(posterior), false);
    assert.throws(() => graduate(), /propose-only subset/);
    assert.throws(() => apply(), /propose-only subset/);
  });
});

test('never creates evolution trust yaml and never reads flywheel scalar', async () => {
  await withSandbox(async (ctx) => {
    await update('facebook', 'voice_trust', { verdict: 'win' }, 'e1', ctx);
    await preview_delta('facebook', 'voice_trust', { ...ctx, maturedWindows: 2, now: '2026-06-03T00:00:00.000Z' });

    const root = resolve('state_root', 'facebook', ctx.env, ctx.configPath).path;
    assert.equal(scanFiles(root).some((file) => file.endsWith(path.join('evolution', 'trust.yaml'))), false);

    const moduleText = readFileSync(path.join(import.meta.dirname, '../lib/trust-posterior.mjs'), 'utf8');
    assert.doesNotMatch(moduleText, /digest-decisions\.json|content-flywheel|trust_score/);
    assert.doesNotMatch(moduleText, /\/Users\/|\/home\//);
    assert.ok(statSync(trustFile(ctx)).isFile());
  });
});
