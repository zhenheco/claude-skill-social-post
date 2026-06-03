import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolve } from '../lib/paths.mjs';
import { MetricsValidationError, validateRow } from '../lib/metrics-schema.mjs';
import { appendRow, readRows } from '../lib/metrics-store.mjs';

const config = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  metrics: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/metrics.jsonl
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/digest-decisions.json
  voice_dir: \${HOME}/Documents/CC Cli/brands/personal/voice
`;

function validRow(overrides = {}) {
  return {
    post_id: 'post-1',
    platform: 'facebook',
    language: 'zh-tw',
    voice_version: '0.1.0',
    posted_at: '2026-06-03T00:00:00.000Z',
    primary_metric: 'save_rate',
    plateau_window: '72h',
    maturity: 'matured',
    metrics: {
      saves: {
        value: 10,
        state: 'captured',
        capture_method: 'manual',
        plateau_age: 72,
        counts_toward_publish_trust: true,
      },
      line_clicks: {
        value: null,
        state: 'absent',
        capture_method: 'manual',
        plateau_age: null,
        counts_toward_publish_trust: false,
      },
    },
    ...overrides,
  };
}

async function withSandbox(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-metrics-'));
  const configPath = path.join(home, 'config.yaml');
  const env = { HOME: home, SKILL_DIR: '.claude' };
  await writeFile(configPath, config, 'utf8');
  try {
    return await fn({ home, configPath, env });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test('T1-T3 metric provenance fields are required before append', async () => {
  await withSandbox(async (ctx) => {
    for (const field of ['state', 'capture_method', 'counts_toward_publish_trust']) {
      const row = validRow();
      delete row.metrics.saves[field];
      await assert.rejects(() => appendRow(row, ctx), (error) => error instanceof MetricsValidationError && error.message.includes(field));
      assert.equal(existsSync(resolve('metrics', 'facebook', ctx.env, ctx.configPath).path), false);
    }
  });
});

test('T4-T5 append is ordered, round-trips rows, and preserves prior byte prefix', async () => {
  await withSandbox(async (ctx) => {
    const rows = [1, 2, 3].map((index) => validRow({ post_id: `post-${index}` }));
    await appendRow(rows[0], ctx);
    await appendRow(rows[1], ctx);
    const file = resolve('metrics', 'facebook', ctx.env, ctx.configPath).path;
    const prefix = await readFile(file, 'utf8');
    await appendRow(rows[2], ctx);
    const bytes = await readFile(file, 'utf8');
    assert.equal(bytes.startsWith(prefix), true);
    assert.deepEqual((await readRows(file)).map((row) => row.post_id), ['post-1', 'post-2', 'post-3']);
  });
});

test('T6 readRows filters matured and provisional rows', async () => {
  await withSandbox(async (ctx) => {
    await appendRow(validRow({ post_id: 'm1', maturity: 'matured' }), ctx);
    await appendRow(validRow({ post_id: 'p1', maturity: 'provisional' }), ctx);
    await appendRow(validRow({ post_id: 'm2', maturity: 'matured' }), ctx);
    const file = resolve('metrics', 'facebook', ctx.env, ctx.configPath).path;
    assert.deepEqual((await readRows(file, { maturity: 'matured' })).map((row) => row.post_id), ['m1', 'm2']);
    assert.deepEqual((await readRows(file, { maturity: 'provisional' })).map((row) => row.post_id), ['p1']);
    assert.equal((await readRows(file)).length, 3);
  });
});

test('T7 absent metrics stay null and are never coerced to zero', async () => {
  await withSandbox(async (ctx) => {
    await appendRow(validRow(), ctx);
    const file = resolve('metrics', 'facebook', ctx.env, ctx.configPath).path;
    const metric = (await readRows(file))[0].metrics.line_clicks;
    assert.equal(metric.state, 'absent');
    assert.equal(metric.value, null);
    assert.notEqual(metric.value, 0);
  });
});

test('T8 top-level fields and platform maturity enums are validated', () => {
  for (const field of ['post_id', 'platform', 'language', 'voice_version', 'posted_at', 'primary_metric', 'plateau_window', 'metrics', 'maturity']) {
    const row = validRow();
    delete row[field];
    assert.throws(() => validateRow(row), new RegExp(field));
  }
  assert.throws(() => validateRow(validRow({ platform: 'tiktok' })), /platform/);
  assert.throws(() => validateRow(validRow({ maturity: 'done' })), /maturity/);
});

test('T9 metric enums and absent invariant are validated', () => {
  assert.throws(() => validateRow(validRow({ metrics: { saves: { ...validRow().metrics.saves, state: 'none' } } })), /state/);
  assert.throws(() => validateRow(validRow({ metrics: { saves: { ...validRow().metrics.saves, capture_method: 'api' } } })), /capture_method/);
  assert.throws(() => validateRow(validRow({ metrics: { saves: { ...validRow().metrics.saves, counts_toward_publish_trust: 'yes' } } })), /counts_toward_publish_trust/);
  assert.throws(() => validateRow(validRow({ metrics: { saves: { ...validRow().metrics.saves, plateau_age: -1 } } })), /plateau_age/);
  assert.throws(() => validateRow(validRow({ metrics: { clicks: { ...validRow().metrics.line_clicks, value: 0 } } })), /absent/);
});

test('T10 append uses issue-01 resolver and never creates trust yaml', async () => {
  await withSandbox(async (ctx) => {
    await appendRow(validRow(), ctx);
    const file = resolve('metrics', 'facebook', ctx.env, ctx.configPath).path;
    assert.equal(existsSync(file), true);
    assert.equal(existsSync(path.join(ctx.home, '.claude/state/social-evolve/facebook/evolution/trust.yaml')), false);
  });
});

test('T11 concurrent appends produce two parseable lines', async () => {
  await withSandbox(async (ctx) => {
    await Promise.all([
      appendRow(validRow({ post_id: 'a' }), ctx),
      appendRow(validRow({ post_id: 'b' }), ctx),
    ]);
    const file = resolve('metrics', 'facebook', ctx.env, ctx.configPath).path;
    const rows = await readRows(file);
    assert.equal(rows.length, 2);
    assert.deepEqual(new Set(rows.map((row) => row.post_id)), new Set(['a', 'b']));
  });
});

test('reader returns empty for a missing file and fails loud on malformed lines', async () => {
  await withSandbox(async (ctx) => {
    const file = resolve('metrics', 'facebook', ctx.env, ctx.configPath).path;
    assert.deepEqual(await readRows(file), []);
    await appendRow(validRow(), ctx);
    await writeFile(file, '{"ok":true}\nnot-json\n', 'utf8');
    await assert.rejects(() => readRows(file), /line 2/);
  });
});
