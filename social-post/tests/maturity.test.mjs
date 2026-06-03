import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { maturity } from '../lib/maturity.mjs';

const windows = Object.freeze({
  maturity_windows: Object.freeze({
    facebook: Object.freeze({ min_age_hours: 72, second_push_window_hours: Object.freeze([24, 48]) }),
    threads: Object.freeze({ min_age_hours: 48, second_push_window_hours: Object.freeze([12, 24]) }),
  }),
});

test('T3 facebook is provisional before the maturity gate and matured after it', () => {
  assert.equal(maturity({ platform: 'facebook', age_hours: 40, second_push_done: false }, windows).verdict, 'provisional');
  assert.equal(maturity({ platform: 'facebook', age_hours: 80, second_push_done: true }, windows).verdict, 'matured');
});

test('T4 platform windows diverge so threads can mature while facebook stays provisional', () => {
  assert.equal(maturity({ platform: 'threads', age_hours: 50, second_push_done: true }, windows).verdict, 'matured');
  assert.equal(maturity({ platform: 'facebook', age_hours: 50, second_push_done: true }, windows).verdict, 'provisional');
});

test('T5 age alone is insufficient without the second-push gate', () => {
  assert.equal(maturity({ platform: 'facebook', age_hours: 80, second_push_done: false }, windows).verdict, 'provisional');
});

test('T8 config parser loads nested maturity windows from yaml without hardcoded literals', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-maturity-config-'));
  const configPath = path.join(home, 'config.yaml');
  await writeFile(configPath, `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  metrics: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/metrics.jsonl
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/digest-decisions.json
maturity_windows:
  facebook:
    min_age_hours: 72
    second_push_window_hours: [24, 48]
  threads:
    min_age_hours: 48
    second_push_window_hours: [12, 24]
`, 'utf8');
  try {
    const loaded = maturity({ platform: 'threads', age_hours: 50, second_push_done: true }, undefined, configPath);
    const content = await readFile(configPath, 'utf8');

    assert.equal(loaded.verdict, 'matured');
    assert.doesNotMatch(content, new RegExp('/(' + ['Users', 'home'].join('|') + ')/|op://'));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
