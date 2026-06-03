import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as voice from '../lib/voice-schema.mjs';
import { dump, parse } from '../lib/yaml.mjs';

function baseVoice(overrides = {}) {
  return {
    version: '0.1.0',
    primary_language: 'zh-tw',
    secondary_language: null,
    switch_rule: 'platform default',
    format_default: 'short-form',
    primary_success_metric: 'save_rate',
    cadence_ceiling: { posts_per_day: 1 },
    forbidden_imports: [],
    hook_style: { allowed: [], banned: [] },
    cta_style: { allowed: [], banned: [] },
    few_shot: [{ text: 'human sample', origin: 'human' }],
    voice_state: { human_sample_count: 1, last_reanchor: null },
    changelog: [],
    applied_proposal_id: null,
    ...overrides,
  };
}

test('semver util accepts only plain x.y.z strings', () => {
  assert.equal(voice.isValidSemver('0.1.0'), true);
  for (const value of ['0.1', '1', 'v1.0.0', '1.0.0.0', '', 1]) {
    assert.equal(voice.isValidSemver(value), false);
  }
});

test('validator accepts a complete facebook voice object', () => {
  assert.deepEqual(voice.validateVoiceFile(baseVoice(), { platform: 'facebook' }), { ok: true, errors: [] });
});

test('validator rejects missing or invalid version with structured error', () => {
  const result = voice.validateVoiceFile(baseVoice({ version: undefined }), { platform: 'facebook' });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'version_invalid_semver');
  assert.equal(result.errors[0].path, 'version');
});

test('few_shot origin must be human or machine and points at the index', () => {
  for (const [index, entry] of [[0, {}], [1, { origin: null }], [2, { origin: 'bot' }]]) {
    const fewShot = [{ origin: 'human' }, { origin: 'human' }, { origin: 'human' }];
    fewShot[index] = entry;
    const result = voice.validateVoiceFile(baseVoice({ few_shot: fewShot }), { platform: 'facebook' });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'few_shot_origin_invalid');
    assert.equal(result.errors[0].path, `few_shot[${index}].origin`);
  }
  assert.equal(voice.validateVoiceFile(baseVoice({ few_shot: [{ origin: 'machine' }] }), { platform: 'facebook' }).ok, true);
});

test('forbidden_imports must be a list', () => {
  for (const forbidden_imports of ['R1', undefined, { rule: 'R1' }]) {
    const result = voice.validateVoiceFile(baseVoice({ forbidden_imports }), { platform: 'facebook' });
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.code === 'forbidden_imports_not_list'), true);
  }
});

test('linkedin must forbid complete R1 through R32 while facebook is exempt', () => {
  const missingR7 = voice.R1_R32.filter((rule) => rule !== 'R7');
  const linkedin = voice.validateVoiceFile(baseVoice({ forbidden_imports: missingR7 }), { platform: 'linkedin' });
  assert.equal(linkedin.ok, false);
  assert.equal(linkedin.errors[0].code, 'linkedin_must_forbid_R1_R32');
  assert.match(linkedin.errors[0].message, /R7/);

  assert.equal(voice.validateVoiceFile(baseVoice({ forbidden_imports: [...voice.R1_R32, 'R99'] }), { platform: 'linkedin' }).ok, true);
  assert.equal(voice.validateVoiceFile(baseVoice({ forbidden_imports: [] }), { platform: 'facebook' }).ok, true);
});

test('scaffold produces valid empty files for all five platforms', () => {
  for (const platform of voice.PLATFORMS) {
    const scaffold = voice.scaffold(platform);
    assert.equal(voice.validateVoiceFile(scaffold, { platform }).ok, true);
    assert.equal(scaffold.version, '0.1.0');
    assert.deepEqual(scaffold.changelog, []);
    assert.equal(scaffold.applied_proposal_id, null);
    assert.deepEqual(scaffold.voice_state, { human_sample_count: 0, last_reanchor: null });
  }
});

test('linkedin scaffold forbids R1-R32 and survives serialization', () => {
  const scaffold = voice.scaffold('linkedin');
  assert.ok(voice.R1_R32.every((rule) => scaffold.forbidden_imports.includes(rule)));
  const loaded = JSON.parse(JSON.stringify(scaffold));
  assert.equal(voice.validateVoiceFile(loaded, { platform: 'linkedin' }).ok, true);
  assert.equal(voice.scaffold('facebook').forbidden_imports.includes('R1'), false);
});

test('unknown and excluded platforms never scaffold', () => {
  for (const platform of ['tiktok', '小紅書', '即刻', '知乎']) {
    assert.throws(() => voice.scaffold(platform), /unsupported|excluded/);
  }
});

test('named exports are present and inputs are not mutated', () => {
  assert.equal(typeof voice.validateVoiceFile, 'function');
  assert.equal(typeof voice.scaffold, 'function');
  assert.equal(typeof voice.isValidSemver, 'function');
  assert.ok(Array.isArray(voice.PLATFORMS));
  assert.ok(Array.isArray(voice.R1_R32));

  const input = baseVoice();
  const before = structuredClone(input);
  voice.validateVoiceFile(input, { platform: 'facebook' });
  assert.deepEqual(input, before);
});

test('YAML dumper round-trips a representative voice scaffold through the subset reader', () => {
  const scaffold = voice.scaffold('facebook');
  const loaded = parse(dump(scaffold));

  assert.deepEqual(loaded, scaffold);
  assert.equal(voice.validateVoiceFile(loaded, { platform: 'facebook' }).ok, true);
});

test('writeVoice writes a human-editable yaml file through configured voice_dir', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-voice-home-'));
  const configPath = path.join(home, 'config.yaml');
  const config = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/digest-decisions.json
  voice_dir: \${HOME}/Documents/CC Cli/brands/personal/voice
`;
  const env = { HOME: home, SKILL_DIR: '.claude', SOCIAL_POST_CONFIG_PATH: configPath };
  const scaffold = voice.scaffold('threads');
  await writeFile(configPath, config, 'utf8');

  try {
    const result = await voice.writeVoice('threads', scaffold, env);
    const content = await readFile(result.path, 'utf8');

    assert.equal(result.path, path.join(home, 'Documents/CC Cli/brands/personal/voice/threads.yaml'));
    assert.doesNotMatch(content, new RegExp('/' + ['Users', 'home'].join('|') + '/'));
    assert.deepEqual(parse(content), scaffold);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
