import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as predictionAdapter from '../lib/adapters/prediction-adapter.mjs';
import { appendRow } from '../lib/metrics-store.mjs';
import * as predictionLog from '../lib/prediction-log.mjs';
import {
  TIER_KEYS,
  brierConvert,
  brierTier,
  normalizeDist,
  sumsToOne,
} from '../lib/prediction-util.mjs';

const config = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  metrics: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/metrics.jsonl
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/digest-decisions.json
  voice_dir: \${HOME}/Documents/CC Cli/brands/personal/voice
maturity_windows:
  facebook:
    min_age_hours: 72
    second_push_window_hours: [24, 48]
prediction:
  cold_start_posts: 20
`;

async function withSandbox(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-prediction-'));
  const configPath = path.join(home, 'config.yaml');
  const env = { HOME: home, SKILL_DIR: '.claude', SOCIAL_POST_CONFIG_PATH: configPath };
  await writeFile(configPath, config, 'utf8');
  try {
    return await fn({ home, configPath, env });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function validInput(overrides = {}) {
  return {
    platform: 'facebook',
    post_id: 'post-1',
    tier_dist: { flop: 0.05, pass: 0.15, good: 0.6, viral: 0.15, mega: 0.05 },
    p_convert: 0.3,
    primary_metric: 'reach',
    plateau_window: '72h',
    voice_version: '0.1.0',
    language: 'zh-tw',
    task_id: 'issue-08',
    session_id: 'test-session',
    ...overrides,
  };
}

function metricsRow(overrides = {}) {
  return {
    post_id: 'post-1',
    platform: 'facebook',
    language: 'zh-tw',
    voice_version: '0.1.0',
    posted_at: '2026-06-03T00:00:00.000Z',
    primary_metric: 'reach',
    plateau_window: '72h',
    maturity: 'matured',
    metrics: {
      reach: {
        value: 1200,
        state: 'captured',
        capture_method: 'manual',
        confidence: 0.9,
        plateau_age: 72,
        counts_toward_publish_trust: true,
      },
      downstream_converts: {
        value: 1,
        state: 'captured',
        capture_method: 'manual',
        confidence: 0.9,
        plateau_age: 72,
        counts_toward_publish_trust: true,
      },
    },
    ...overrides,
  };
}

async function laneRows(env, platform = 'facebook') {
  return predictionAdapter.readLane(`social-${platform}`, { env });
}

test('T1 log rejects a tier distribution whose sum is not near one and writes nothing', async () => {
  await withSandbox(async ({ env }) => {
    const result = await predictionLog.log(validInput({
      tier_dist: { flop: 0.1, pass: 0.1, good: 0.2, viral: 0.2, mega: 0.1 },
    }), { env });

    assert.equal(result.ok, false);
    assert.match(result.error, /sum.*~1/);
    assert.deepEqual(await laneRows(env), []);
  });
});

test('T2 log rejects wrong tier keys, negative mass, and invalid conversion probability', async () => {
  await withSandbox(async ({ env }) => {
    const missing = await predictionLog.log(validInput({
      tier_dist: { flop: 0.1, pass: 0.2, good: 0.5, viral: 0.2 },
    }), { env });
    const negative = await predictionLog.log(validInput({
      tier_dist: { flop: -0.1, pass: 0.2, good: 0.6, viral: 0.2, mega: 0.1 },
    }), { env });
    const badConvert = await predictionLog.log(validInput({ p_convert: 2 }), { env });

    assert.equal(missing.ok, false);
    assert.match(missing.error, /keys/);
    assert.equal(negative.ok, false);
    assert.match(negative.error, /range/);
    assert.equal(badConvert.ok, false);
    assert.match(badConvert.error, /p_convert/);
    assert.deepEqual(await laneRows(env), []);
  });
});

test('T9 distribution utilities are pure and enforce the sum tolerance', () => {
  const input = Object.freeze({ flop: 0.001, pass: 0.199, good: 0.6, viral: 0.15, mega: 0.05 });
  const normalized = normalizeDist(input);

  assert.notEqual(normalized, input);
  assert.deepEqual(input, { flop: 0.001, pass: 0.199, good: 0.6, viral: 0.15, mega: 0.05 });
  assert.equal(sumsToOne(normalized), true);
  assert.equal(sumsToOne({ flop: 0.1, pass: 0.1, good: 0.2, viral: 0.2, mega: 0.1 }), false);
  assert.deepEqual(TIER_KEYS, ['flop', 'pass', 'good', 'viral', 'mega']);
});

test('T8 Brier utilities score tier and conversion predictions separately', () => {
  assert.equal(brierTier({ flop: 0, pass: 0, good: 1, viral: 0, mega: 0 }, 'good'), 0);
  assert.equal(brierTier({ flop: 1, pass: 0, good: 0, viral: 0, mega: 0 }, 'mega'), 2);
  assert.equal(brierConvert(0, true), 1);
  assert.equal(brierConvert(1, true), 0);
});

test('T3 valid log writes a full falsifiable prediction record through the adapter lane', async () => {
  await withSandbox(async ({ env }) => {
    const result = await predictionLog.log(validInput(), { env, priorMaturedCount: 0 });
    const rows = await laneRows(env);

    assert.equal(result.ok, true);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].lane, 'social-facebook');
    assert.equal(rows[0].type, 'social-prediction');
    assert.equal(rows[0].voice_version, '0.1.0');
    assert.equal(rows[0].language, 'zh-tw');
    assert.equal(rows[0].primary_metric, 'reach');
    assert.equal(rows[0].plateau_window, '72h');
    assert.deepEqual(rows[0].tier_dist, validInput().tier_dist);
    assert.equal(rows[0].p_convert, 0.3);
    assert.equal(rows[0].post_id, 'post-1');
    assert.equal(rows[0].cold_start, true);
    assert.equal(rows[0].trust_eligible, false);
    assert.equal(rows[0].task_id, 'issue-08');
    assert.equal(rows[0].session_id, 'test-session');
    assert.match(rows[0].ts, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test('T4 score skips provisional metrics rows and writes no outcome', async () => {
  await withSandbox(async ({ env }) => {
    await predictionLog.log(validInput(), { env });

    const result = await predictionLog.score('post-1', {
      env,
      platform: 'facebook',
      metricsRow: metricsRow({ maturity: 'provisional' }),
    });
    const outcomes = (await laneRows(env)).filter((row) => row.type === 'social-prediction-outcome');

    assert.deepEqual(result, { resolved: false, reason: 'not-matured' });
    assert.deepEqual(outcomes, []);
  });
});

test('T5 score resolves matured rows with separate Brier fields and no posterior', async () => {
  await withSandbox(async ({ env, configPath }) => {
    await predictionLog.log(validInput(), { env });
    await appendRow(metricsRow(), { env, configPath });

    const result = await predictionLog.score('post-1', { env });
    const [outcome] = (await laneRows(env)).filter((row) => row.type === 'social-prediction-outcome');

    assert.equal(result.resolved, true);
    assert.equal(result.posterior, undefined);
    assert.equal(result.apply, undefined);
    assert.equal(outcome.realized_tier, 'good');
    assert.equal(outcome.realized_convert, true);
    assert.equal(Number.isFinite(outcome.brier_tier), true);
    assert.equal(Number.isFinite(outcome.brier_convert), true);
    assert.notEqual(outcome.brier_tier, outcome.brier_convert);
    assert.equal(outcome.cold_start, true);
    assert.equal(outcome.trust_eligible, false);
  });
});

test('T6 score skips no-data rows and never writes a prediction miss outcome', async () => {
  await withSandbox(async ({ env }) => {
    await predictionLog.log(validInput(), { env });

    const result = await predictionLog.score('post-1', {
      env,
      platform: 'facebook',
      metricsRow: metricsRow({
        kind: 'no-data',
        counts_as_prediction_miss: false,
        metrics: {},
      }),
    });
    const outcomes = (await laneRows(env)).filter((row) => row.type === 'social-prediction-outcome');

    assert.deepEqual(result, { resolved: false, reason: 'no-data' });
    assert.deepEqual(outcomes, []);
  });
});

test('T7 cold-start flags posts 1-20 as trust-ineligible and post 21 onward as eligible', async () => {
  await withSandbox(async ({ env, configPath }) => {
    for (let index = 1; index <= 25; index += 1) {
      const postId = `post-${index}`;
      await predictionLog.log(validInput({ post_id: postId }), { env, priorMaturedCount: index - 1 });
      await predictionLog.score(postId, {
        env,
        platform: 'facebook',
        metricsRow: metricsRow({ post_id: postId }),
      });
    }

    const rows = await laneRows(env);
    const predictions = rows.filter((row) => row.type === 'social-prediction');
    const outcomes = rows.filter((row) => row.type === 'social-prediction-outcome');

    assert.equal(predictions.length, 25);
    assert.equal(outcomes.length, 25);
    for (const row of [...predictions.slice(0, 20), ...outcomes.slice(0, 20)]) {
      assert.equal(row.cold_start, true);
      assert.equal(row.trust_eligible, false);
    }
    for (const row of [...predictions.slice(20), ...outcomes.slice(20)]) {
      assert.equal(row.cold_start, false);
      assert.equal(row.trust_eligible, true);
    }

    for (let index = 1; index <= 20; index += 1) {
      await appendRow(metricsRow({ post_id: `matured-${index}` }), { env, configPath });
    }
    await predictionLog.log(validInput({ post_id: 'post-26' }), { env });
    const post26 = (await laneRows(env)).find((row) => row.post_id === 'post-26');
    assert.equal(post26.cold_start, false);
  });
});

test('T10 module exports no apply or graduate path and writes no posterior file', async () => {
  await withSandbox(async ({ env, home }) => {
    await predictionLog.log(validInput(), { env });
    await predictionLog.score('post-1', { env, platform: 'facebook', metricsRow: metricsRow() });

    assert.equal(typeof predictionLog.apply, 'undefined');
    assert.equal(typeof predictionLog.graduate, 'undefined');
    assert.equal(existsSync(path.join(home, '.claude/state/social-evolve/facebook/posterior.json')), false);
    assert.equal(existsSync(path.join(home, '.claude/state/social-evolve/facebook/trust-posterior.json')), false);
  });
});

test('T11 prediction logger source has no secrets, hardcoded home paths, or direct prediction-store path', async () => {
  const source = await readFile(new URL('../lib/prediction-log.mjs', import.meta.url), 'utf8');
  const hardcodedHome = new RegExp('/(' + ['Users', 'home'].join('|') + ')/');

  assert.doesNotMatch(source, hardcodedHome);
  assert.doesNotMatch(source, /op:\/\//);
  assert.doesNotMatch(source, /token|secret/i);
  assert.doesNotMatch(source, /predictions\//);
});
