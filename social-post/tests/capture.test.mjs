import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolve } from '../lib/paths.mjs';
import { readRows } from '../lib/metrics-store.mjs';
import { SNAPSHOT_SLOTS, capture, enrich, isPredictionMiss } from '../lib/capture.mjs';

const config = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  metrics: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/metrics.jsonl
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/digest-decisions.json
  voice_dir: \${HOME}/Documents/CC Cli/brands/personal/voice
`;

async function withSandbox(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-capture-'));
  const configPath = path.join(home, 'config.yaml');
  const env = { HOME: home, SKILL_DIR: '.claude' };
  await writeFile(configPath, config, 'utf8');
  try {
    return await fn({ home, configPath, env });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function baseCapture(overrides = {}) {
  return {
    post_id: 'post-1',
    platform: 'facebook',
    language: 'zh-tw',
    voice_version: '0.1.0',
    posted_at: '2026-06-03T00:00:00.000Z',
    primary_metric: 'reach',
    plateau_window: '72h',
    method: 'manual',
    metrics: {},
    ...overrides,
  };
}

test('T2 empty manual capture writes no-data and is never a prediction miss', async () => {
  await withSandbox(async (ctx) => {
    await capture(baseCapture(), ctx);

    const file = resolve('metrics', 'facebook', ctx.env, ctx.configPath).path;
    const rows = await readRows(file);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'no-data');
    assert.equal(rows[0].counts_as_prediction_miss, false);
    assert.equal(isPredictionMiss(rows[0]), false);
  });
});

test('T1 manual capture tags metric provenance and snapshot slots', async () => {
  await withSandbox(async (ctx) => {
    await capture(baseCapture({
      metrics: {
        reach: { value: 1200, confidence: 0.9 },
      },
    }), ctx);

    const file = resolve('metrics', 'facebook', ctx.env, ctx.configPath).path;
    const [row] = await readRows(file);

    assert.equal(row.metrics.reach.value, 1200);
    assert.equal(row.metrics.reach.state, 'captured');
    assert.equal(row.metrics.reach.capture_method, 'manual');
    assert.equal(row.metrics.reach.confidence, 0.9);
    assert.deepEqual(Object.keys(row.snapshots), SNAPSHOT_SLOTS);
    assert.deepEqual(row.snapshots, { '6h': null, '24h': null, '48h': null, '72h': null });
  });
});

test('T6 scrape enrichment fills absent metrics without overwriting manual values', () => {
  const row = {
    post_id: 'post-1',
    platform: 'facebook',
    metrics: {
      reach: {
        value: 1200,
        state: 'captured',
        capture_method: 'manual',
        confidence: 0.9,
        plateau_age: 72,
        counts_toward_publish_trust: true,
      },
      link_clicks: {
        value: null,
        state: 'absent',
        capture_method: 'manual',
        confidence: 0.2,
        plateau_age: null,
        counts_toward_publish_trust: false,
      },
    },
  };

  const originalManual = structuredClone(row.metrics.reach);
  const result = enrich(row, {
    reach: { value: 9999, confidence: 0.99 },
    link_clicks: { value: 3, confidence: 0.7 },
  });

  assert.deepEqual(result.metrics.reach, originalManual);
  assert.equal(result.metrics.link_clicks.value, 3);
  assert.equal(result.metrics.link_clicks.state, 'captured');
  assert.equal(result.metrics.link_clicks.capture_method, 'scrape');
  assert.equal(result.metrics.link_clicks.confidence, 0.7);
});

test('T7 enrich returns a new row and leaves the original unchanged', () => {
  const row = {
    post_id: 'post-1',
    platform: 'facebook',
    metrics: {
      link_clicks: {
        value: null,
        state: 'absent',
        capture_method: 'manual',
        confidence: 0.2,
        plateau_age: null,
        counts_toward_publish_trust: false,
      },
    },
  };
  const before = structuredClone(row);

  const result = enrich(row, { link_clicks: { value: 5, confidence: 0.8 } });

  assert.notEqual(result, row);
  assert.notEqual(result.metrics, row.metrics);
  assert.deepEqual(row, before);
});
