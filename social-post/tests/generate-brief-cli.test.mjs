import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

const config = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/digest-decisions.json
  voice_dir: \${HOME}/Documents/CC Cli/brands/personal/voice
`;

const core = `name: Nelson Chou
niche: "企業 AI 導入"
values:
  - "實戰導向"
avoid_topics:
  - "政治"
voice_directive:
  sharpness: high
  demonstrate_expertise: true
  proof_over_claim: true
objective_hierarchy:
  - tier: apex
    metrics: [line_utm_joins]
automation_policy:
  auto_send: false
  mode: propose_only
`;

function voice({ fewShot = true } = {}) {
  return `primary_language: zh-tw
format_default: short-thread
cadence_ceiling:
  posts_per_day: 1
forbidden_imports:
  - R25
hook_style:
  allowed:
    - news_hottake
cta_style:
  allowed: []
style_fingerprint:
  sentence_length_bucket: long
  avg_beats: 3
  emoji_density: 0
  link_rate: 0
  register_hint: personal
few_shot:${fewShot ? `
  - pattern: news_hottake
    skeleton: "{工具} 出了 {新功能}。{反直覺判斷}。"
    origin: benchmark_distilled
    source_ids: "threads:a"` : ' []'}
`;
}

async function withFixture(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-generate-brief-'));
  const configPath = path.join(home, 'config.yaml');
  const corePath = path.join(home, 'Documents/CC Cli/brands/personal/core.yaml');
  const voicePath = path.join(home, 'Documents/CC Cli/brands/personal/voice/threads.yaml');
  await mkdir(path.dirname(corePath), { recursive: true });
  await mkdir(path.dirname(voicePath), { recursive: true });
  await writeFile(configPath, config, 'utf8');
  await writeFile(corePath, core, 'utf8');
  await writeFile(voicePath, voice(), 'utf8');
  try {
    return await fn({ configPath, corePath, home, voicePath });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test('generate-brief prints tone directive, style targets, archetype skeleton, and propose-only footer', async () => {
  await withFixture(async ({ configPath, corePath, home }) => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['scripts/generate-brief.mjs', '--platform', 'threads', '--topic', 'AI rollout', '--recent', 'none', '--n', '1'],
      {
        cwd: path.join(import.meta.dirname, '..'),
        env: { ...process.env, HOME: home, SKILL_DIR: '.claude', SOCIAL_POST_CONFIG_PATH: configPath, SOCIAL_POST_CORE_PATH: corePath },
      },
    );

    assert.match(stdout, /# Generation Brief: threads/);
    assert.match(stdout, /Identity: Nelson Chou/);
    assert.match(stdout, /TONE DIRECTIVE/);
    assert.match(stdout, /更銳 sharpness:high/);
    assert.match(stdout, /展現實力 demonstrate_expertise:true/);
    assert.match(stdout, /proof_over_claim:true/);
    assert.match(stdout, /Target language: zh-tw/);
    assert.match(stdout, /Topic: AI rollout/);
    assert.match(stdout, /news_hottake/);
    assert.match(stdout, /\{工具\} 出了 \{新功能\}/);
    assert.match(stdout, /sentence_length_bucket: long/);
    assert.match(stdout, /avg_beats: 3/);
    assert.match(stdout, /Apex CTA reminder: line_utm_joins/);
    assert.match(stdout, /BANS: 政治, R25/);
    assert.match(stdout, /Output is a DRAFT only\. Human posts every word\. No auto-send \(automation_policy\.mode=propose_only\)\./);
  });
});

test('generate-brief prints a clear unseeded notice and exits zero', async () => {
  await withFixture(async ({ configPath, corePath, home, voicePath }) => {
    await writeFile(voicePath, voice({ fewShot: false }), 'utf8');

    const { stdout } = await execFileAsync(
      process.execPath,
      ['scripts/generate-brief.mjs', '--platform', 'threads'],
      {
        cwd: path.join(import.meta.dirname, '..'),
        env: { ...process.env, HOME: home, SKILL_DIR: '.claude', SOCIAL_POST_CONFIG_PATH: configPath, SOCIAL_POST_CORE_PATH: corePath },
      },
    );

    assert.match(stdout, /voice not seeded for threads — run voice-bootstrap first/);
  });
});
