import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appendRaw,
  rawFile,
  readRaw,
} from '../lib/voice-bootstrap/raw-store.mjs';
import { seedVoice } from '../lib/voice-bootstrap/seed.mjs';
import { parse } from '../lib/yaml.mjs';

const configText = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  inspiration: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/inspiration
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/decisions-store.json
  voice_dir: \${HOME}/brands/personal/voice
`;

async function withSandbox(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'voice-bootstrap-'));
  const configPath = path.join(home, 'config.yaml');
  const env = { HOME: home, SKILL_DIR: '.claude', SOCIAL_POST_CONFIG_PATH: configPath };
  await writeFile(configPath, configText, 'utf8');
  try {
    return await fn({ home, env, configPath, voiceDir: path.join(home, 'brands/personal/voice') });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function voiceYaml(overrides = {}) {
  return `version: ${overrides.version ?? '1.2.3'}
hook_style:
  allowed:
    - existing_hook
style_fingerprint:
  sentence_length_bucket: short
few_shot:
  - pattern: existing_hook
    skeleton: existing skeleton
    origin: human
    source_ids: owner
voice_state:
  human_sample_count: ${overrides.humanSampleCount ?? 0}
  benchmark_sample_count: ${overrides.benchmarkSampleCount ?? 0}
  benchmark_sources: ${overrides.benchmarkSources ?? ''}
  last_distill: ${overrides.lastDistill ?? ''}
automation_policy:
  mode: propose_only
  auto_send: false
legacy_voice:
  sentence: keep legacy
user_custom:
  note: keep custom
changelog:
  - ${overrides.changelog ?? '2026-06-01 initial'}
`;
}

const distilled = Object.freeze({
  patterns: [
    Object.freeze({
      pattern: 'vulnerability_reveal',
      count: 2,
      skeleton: '{placeholder} reveal then lesson',
      source_ids: Object.freeze(['src-a', 'src-b']),
      single_source: false,
    }),
    Object.freeze({
      pattern: 'principle_contrast',
      count: 1,
      skeleton: 'not {placeholder} but principle',
      source_ids: Object.freeze(['src-b']),
      single_source: true,
    }),
  ],
  style_fingerprint: Object.freeze({
    sentence_length_bucket: 'medium',
    emoji_density: 0.25,
    avg_beats: 2,
    link_rate: 0.5,
    register_hint: 'personal',
  }),
  style_fingerprint_by_lang: Object.freeze({
    'zh-tw': Object.freeze({
      sentence_length_bucket: 'short',
      emoji_density: 0,
      avg_beats: 1.5,
      link_rate: 0,
      register_hint: 'personal',
    }),
    en: Object.freeze({
      sentence_length_bucket: 'medium',
      emoji_density: 0.5,
      avg_beats: 2,
      link_rate: 0.5,
      register_hint: 'operator',
    }),
  }),
  sample_count: 3,
});

test('raw-store appends injected captured_at lines, sanitizes filenames, and reads ENOENT as empty', async () => {
  await withSandbox(async ({ env, configPath, home }) => {
    const sourceId = '../Bench Mark:@Acme';
    const file = rawFile('threads', sourceId, { env, configPath });

    assert.equal(file, path.join(home, '.claude/state/social-evolve/threads/inspiration/_raw/Bench-Mark-Acme.jsonl'));
    assert.deepEqual(await readRaw('threads', sourceId, { env, configPath }), []);

    await appendRaw('threads', sourceId, [
      { text: 'first', engagement: { likes: 1, comments: 2, reposts: 3, shares: 4 } },
      { text: 'second', engagement: { likes: 5 } },
    ], { env, configPath, now: '2026-06-04T00:00:00.000Z' });

    assert.deepEqual(await readRaw('threads', sourceId, { env, configPath }), [
      {
        source_id: sourceId,
        text: 'first',
        engagement: { likes: 1, comments: 2, reposts: 3, shares: 4 },
        captured_at: '2026-06-04T00:00:00.000Z',
      },
      {
        source_id: sourceId,
        text: 'second',
        engagement: { likes: 5, comments: 0, reposts: 0, shares: 0 },
        captured_at: '2026-06-04T00:00:00.000Z',
      },
    ]);
  });
});

test('seedVoice bootstrap mutates voice with benchmark patterns, version bump, changelog, and preserved sections', async () => {
  await withSandbox(async ({ voiceDir }) => {
    await import('node:fs/promises').then(({ mkdir }) => mkdir(voiceDir, { recursive: true }));
    const voicePath = path.join(voiceDir, 'threads.yaml');
    await writeFile(voicePath, voiceYaml(), 'utf8');

    const before = parse(await readFile(voicePath, 'utf8'));
    const result = await seedVoice('threads', distilled, {
      voiceDir,
      now: '2026-06-04T12:00:00.000Z',
      mode: 'bootstrap',
    });
    const afterText = await readFile(voicePath, 'utf8');
    const after = parse(afterText);

    assert.equal(result.seeded, true);
    assert.equal(result.proposal, null);
    assert.equal(after.version, '1.3.0');
    assert.deepEqual(after.hook_style.allowed, ['existing_hook', 'vulnerability_reveal', 'principle_contrast']);
    assert.deepEqual(after.style_fingerprint, distilled.style_fingerprint);
    assert.deepEqual(
      after.style_fingerprint_by_lang,
      distilled.style_fingerprint_by_lang,
      'seedVoice should persist per-language style targets so later generation can select the target language',
    );
    assert.equal(after.few_shot.length, 3);
    assert.equal(after.few_shot[1].origin, 'benchmark_distilled');
    assert.equal(after.few_shot[1].skeleton, '{placeholder} reveal then lesson');
    assert.equal(after.voice_state.benchmark_sample_count, 3);
    assert.equal(after.voice_state.benchmark_sources, 'src-a,src-b');
    assert.equal(after.voice_state.last_distill, '2026-06-04T12:00:00.000Z');
    assert.equal(after.changelog.at(-1), '2026-06-04T12:00:00.000Z benchmark_distilled voice bootstrap');
    assert.deepEqual(after.legacy_voice, before.legacy_voice);
    assert.deepEqual(after.user_custom, before.user_custom);
    assert.deepEqual(after.automation_policy, before.automation_policy);
  });
});

test('seedVoice returns proposal and leaves voice unchanged after human samples exist', async () => {
  await withSandbox(async ({ voiceDir }) => {
    await import('node:fs/promises').then(({ mkdir }) => mkdir(voiceDir, { recursive: true }));
    const voicePath = path.join(voiceDir, 'threads.yaml');
    await writeFile(voicePath, voiceYaml({ humanSampleCount: 2 }), 'utf8');
    const before = await readFile(voicePath, 'utf8');

    const result = await seedVoice('threads', distilled, {
      voiceDir,
      now: '2026-06-04T12:00:00.000Z',
      mode: 'bootstrap',
      propose: async (candidate) => ({ written: true, candidate }),
    });

    assert.equal(result.seeded, false);
    assert.equal(result.proposal.kind, 'voice_tweak');
    assert.equal(result.proposal.platform, 'threads');
    assert.equal(result.proposal.text.includes('benchmark_distilled'), true);
    assert.equal(await readFile(voicePath, 'utf8'), before);
  });
});

test('seedVoice non-bootstrap returns proposal and leaves cold-start voice unchanged', async () => {
  await withSandbox(async ({ voiceDir }) => {
    await import('node:fs/promises').then(({ mkdir }) => mkdir(voiceDir, { recursive: true }));
    const voicePath = path.join(voiceDir, 'threads.yaml');
    await writeFile(voicePath, voiceYaml(), 'utf8');
    const before = await readFile(voicePath, 'utf8');

    const result = await seedVoice('threads', distilled, {
      voiceDir,
      now: '2026-06-04T12:00:00.000Z',
      mode: 'propose',
      propose: async (candidate) => ({ written: true, candidate }),
    });

    assert.equal(result.seeded, false);
    assert.ok(result.proposal.evidence.includes('benchmark_sample_count: 3'));
    assert.equal(await readFile(voicePath, 'utf8'), before);
    assert.equal(existsSync(voicePath), true);
  });
});
