import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { distill, distillRaw } from '../lib/distill.mjs';
import { get, upsert, weight } from '../lib/sources.mjs';
import { parse } from '../lib/yaml.mjs';

const configTemplate = (home) => `paths:
  state_root: ${home}/.claude/state/social-evolve
  metrics: ${home}/.claude/state/social-evolve/\${platform}/metrics.jsonl
  inspiration: ${home}/.claude/state/social-evolve/\${platform}/inspiration
  account_health: ${home}/.claude/state/social-evolve/\${platform}/account-health.yaml
  runs: ${home}/.claude/state/social-evolve/\${platform}/runs
  quota_ledger: ${home}/.claude/state/social-evolve/\${platform}/quota-ledger.jsonl
  predictions_dir: ${home}/.claude/state/predictions
  decisions_file: ${home}/.claude/state/digest-decisions.json
  voice_dir: ${home}/brands/personal/voice
`;

async function withTempConfig(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-distill-home-'));
  const configPath = path.join(home, 'config.yaml');
  await writeFile(configPath, configTemplate(home), 'utf8');
  try {
    return await fn({ home, configPath, env: { HOME: home, SKILL_DIR: '.claude' } });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test('T1 distill emits entity-free archetype instead of raw external text', () => {
  const result = distill({
    source_id: 'linkedin-benchmark',
    raw_text: 'Just shipped v2. Jane Doe at Acme crushed it, see https://acme.co/x. 3 lessons: @jane_doe jane@acme.com',
  });

  assert.match(result.abstracted_template, /proof-open/);
  assert.match(result.abstracted_template, /numbered-listicle/);
  assert.doesNotMatch(result.abstracted_template, /jane|doe|acme|@|https?:|\.co|v2|3/i);
  assert.deepEqual(result.originality_inputs, {
    pattern_origin: 'external',
    internal_winner_required: true,
  });
  assert.equal(result.source_id, 'linkedin-benchmark');
  assert.ok(result.distilled_at);
});

test('T5 distill fails closed when residual PII-like tokens remain', () => {
  assert.throws(
    () =>
      distill({
        source_id: 'forum-snippet',
        raw_text: 'Operator trace customer-ab12cd34ef56 should not leave quarantine.',
      }),
    /residual PII/i,
  );
});

test('T4 distillRaw appends entity-free templates without leaking quarantined raw text', async () => {
  await withTempConfig(async ({ home, configPath, env }) => {
    const rawDir = path.join(home, '.claude/state/social-evolve/linkedin/inspiration/_raw');
    await mkdir(rawDir, { recursive: true });
    const rawRecord = {
      captured_at: '2026-06-03T10:00:00.000Z',
      ttl_expires_at: '2026-06-10T10:00:00.000Z',
      source_id: 'benchmark-account',
      access_mode: 'logged_out_webfetch',
      raw_text: 'Just shipped v2. Jane Doe at Acme shared 3 lessons from a launch.',
    };
    await writeFile(path.join(rawDir, 'capture.json'), JSON.stringify(rawRecord), 'utf8');

    const entry = await distillRaw(rawRecord, {
      platform: 'linkedin',
      env,
      configPath,
      now: new Date('2026-06-03T11:00:00.000Z'),
    });
    await distillRaw(rawRecord, {
      platform: 'linkedin',
      env,
      configPath,
      now: new Date('2026-06-03T11:30:00.000Z'),
    });
    const yamlPath = path.join(home, '.claude/state/social-evolve/linkedin/inspiration/linkedin.yaml');
    const content = await readFile(yamlPath, 'utf8');
    const parsed = parse(content);
    const sources = parse(
      await readFile(path.join(home, '.claude/state/social-evolve/linkedin/inspiration/sources.yaml'), 'utf8'),
    );

    assert.equal(entry.source_id, 'benchmark-account');
    assert.equal(parsed.abstracted_templates.length, 1);
    assert.equal(parsed.abstracted_templates[0].source_id, 'benchmark-account');
    assert.equal(parsed.abstracted_templates[0].distilled_at, '2026-06-03T11:00:00.000Z');
    assert.equal(parsed.abstracted_templates[0].ttl_expires_at, '2026-06-10T10:00:00.000Z');
    assert.equal(parsed.abstracted_templates[0].candidate_status, 'needs_internal_r6_winner');
    assert.equal(sources.sources[0].trust, 0.5);
    assert.equal(sources.sources[0].influence_cap, 0.25);
    assert.equal(sources.sources[0].access_mode, 'logged_out_webfetch');
    assert.doesNotMatch(content, /Jane|Doe|Acme|Just shipped v2|3 lessons/i);
    assert.equal(await readFile(path.join(rawDir, 'capture.json'), 'utf8'), JSON.stringify(rawRecord));
  });
});

test('T7 sources governance round-trips records and caps weighted influence', async () => {
  await withTempConfig(async ({ configPath, env }) => {
    await upsert(
      { source_id: 'dominant-source', trust: 0.9, influence_cap: 0.2, access_mode: 'logged_out_webfetch', drift_flag: false },
      { platform: 'linkedin', env, configPath },
    );
    await upsert(
      { source_id: 'secondary-source', trust: 0.5, influence_cap: 1, access_mode: 'grounded_search', drift_flag: false },
      { platform: 'linkedin', env, configPath },
    );

    assert.deepEqual(await get('dominant-source', { platform: 'linkedin', env, configPath }), {
      source_id: 'dominant-source',
      trust: 0.9,
      influence_cap: 0.2,
      access_mode: 'logged_out_webfetch',
      drift_flag: false,
    });

    const weighted = weight(
      [
        { source_id: 'dominant-source', abstracted_template: 'a' },
        { source_id: 'dominant-source', abstracted_template: 'b' },
        { source_id: 'dominant-source', abstracted_template: 'c' },
        { source_id: 'dominant-source', abstracted_template: 'd' },
        { source_id: 'secondary-source', abstracted_template: 'e' },
      ],
      [
        { source_id: 'dominant-source', trust: 0.9, influence_cap: 0.2 },
        { source_id: 'secondary-source', trust: 0.5, influence_cap: 1 },
      ],
    );
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    const dominantTotal = weighted
      .filter((item) => item.source_id === 'dominant-source')
      .reduce((sum, item) => sum + item.weight, 0);

    assert.ok(dominantTotal / total <= 0.2);
    assert.equal(weighted.length, 5);
  });
});
