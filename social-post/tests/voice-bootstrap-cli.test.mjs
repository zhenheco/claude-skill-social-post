import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readRaw } from '../lib/voice-bootstrap/raw-store.mjs';

const configText = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  inspiration: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/inspiration
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/decisions-store.json
  voice_dir: \${HOME}/brands/personal/voice
`;

async function withCliSandbox(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'voice-bootstrap-cli-'));
  const configPath = path.join(home, 'config.yaml');
  const env = {
    ...process.env,
    HOME: home,
    SKILL_DIR: '.claude',
    SOCIAL_POST_CONFIG_PATH: configPath,
  };
  await writeFile(configPath, configText, 'utf8');
  try {
    return await fn({ home, env, configPath });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['scripts/voice-bootstrap.mjs', ...args], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

async function writeSources(home, platform = 'threads', sourcesText = null) {
  const inspirationDir = path.join(home, `.claude/state/social-evolve/${platform}/inspiration`);
  await mkdir(inspirationDir, { recursive: true });
  await writeFile(path.join(inspirationDir, 'sources.yaml'), sourcesText ?? `sources:
  - source_id: public-a
    trust: 0.8
    influence_cap: 0.2
    access_mode: logged_out_webfetch
    drift_flag: false
  - source_id: linkedin-native
    trust: 0.5
    influence_cap: 0.2
    access_mode: auth_required_deferred
    drift_flag: false
`, 'utf8');
}

async function writeVoice(home, platform = 'threads') {
  const voiceDir = path.join(home, 'brands/personal/voice');
  await mkdir(voiceDir, { recursive: true });
  const voicePath = path.join(voiceDir, `${platform}.yaml`);
  const content = `version: 0.1.0
hook_style:
  allowed: []
style_fingerprint: {}
few_shot: []
voice_state:
  human_sample_count: 0
automation_policy:
  mode: propose_only
  auto_send: false
legacy_voice:
  sentence: keep
user_custom:
  note: keep
changelog: []
`;
  await writeFile(voicePath, content, 'utf8');
  return voicePath;
}

function rawRows(count, engagement = { likes: 10, comments: 2, reposts: 0, shares: 0 }) {
  return Array.from({ length: count }, (_, index) => JSON.stringify({
    source_id: 'public-a',
    text: `老實說 Acme 做了 ${index + 1000} 件事，結果懂了`,
    engagement,
    captured_at: '2026-06-04T00:00:00.000Z',
  }));
}

test('--ingest populates quarantine from pre-fetched jsonl using injected captured_at argument', async () => {
  await withCliSandbox(async ({ home, env, configPath }) => {
    const ingestPath = path.join(home, 'ingest.jsonl');
    await writeFile(ingestPath, [
      JSON.stringify({ source_id: 'public-a', text: '老實說 Acme 讓我學到一件事', engagement: { likes: 3 } }),
      JSON.stringify({ source_id: 'public-a', text: '不是流量，是轉換', engagement: { shares: 2 } }),
    ].join('\n'), 'utf8');

    const result = await runCli(['--platform', 'threads', '--ingest', ingestPath, '--captured-at', '2026-06-04T00:00:00.000Z'], env);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /bootstrap-log ingest platform=threads source_id=public-a count=2/);
    const rows = await readRaw('threads', 'public-a', {
      env: { HOME: home, SKILL_DIR: '.claude' },
      configPath,
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].captured_at, '2026-06-04T00:00:00.000Z');
  });
});

test('--dry-run skips auth_required_deferred sources and writes no voice mutations', async () => {
  await withCliSandbox(async ({ home, env }) => {
    await writeSources(home);
    const voicePath = await writeVoice(home);
    const before = await readFile(voicePath, 'utf8');
    await runCli([
      '--platform', 'threads',
      '--ingest', path.join(home, 'missing.jsonl'),
      '--captured-at', '2026-06-04T00:00:00.000Z',
    ], env).catch(() => {});
    const rawDir = path.join(home, '.claude/state/social-evolve/threads/inspiration/_raw');
    await mkdir(rawDir, { recursive: true });
    await writeFile(path.join(rawDir, 'public-a.jsonl'), [
      JSON.stringify({
        source_id: 'public-a',
        text: '老實說 Acme 做了 1000 件事，結果懂了',
        engagement: { likes: 10, comments: 2, reposts: 0, shares: 0 },
        captured_at: '2026-06-04T00:00:00.000Z',
      }),
      JSON.stringify({
        source_id: 'public-a',
        text: '老實說 Beta 做了 2000 件事，結果懂了',
        engagement: { likes: 9, comments: 2, reposts: 0, shares: 0 },
        captured_at: '2026-06-04T00:00:00.000Z',
      }),
    ].join('\n'), 'utf8');

    const result = await runCli([
      '--platform', 'threads',
      '--dry-run',
      '--min-engagement', '0',
      '--allow-underfilled',
      '--reason', 'fixture has only two rows',
    ], env);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /bootstrap-log skip platform=threads source_id=linkedin-native access_mode=auth_required_deferred/);
    assert.match(result.stdout, /bootstrap-log dry-run platform=threads patterns=1 sample_count=2/);
    assert.equal(await readFile(voicePath, 'utf8'), before);
  });
});

test('--coverage writes coverage.json and prints the coverage summary', async () => {
  await withCliSandbox(async ({ home, env }) => {
    await writeSources(home);
    const rawDir = path.join(home, '.claude/state/social-evolve/threads/inspiration/_raw');
    await mkdir(rawDir, { recursive: true });
    await writeFile(path.join(rawDir, 'public-a.jsonl'), rawRows(20).join('\n'), 'utf8');

    const result = await runCli(['--platform', 'threads', '--coverage', '--now', '2026-06-04T12:00:00.000Z'], env);
    const coveragePath = path.join(home, '.claude/state/social-evolve/threads/inspiration/coverage.json');
    const coverage = JSON.parse(await readFile(coveragePath, 'utf8'));

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /bootstrap-log coverage platform=threads ok=true sample_count=20 minimum=20/);
    assert.equal(coverage.platform, 'threads');
    assert.equal(coverage.sample_count, 20);
    assert.equal(coverage.generated_at, '2026-06-04T12:00:00.000Z');
  });
});

test('--discover-sources writes social source candidates without raw capture', async () => {
  await withCliSandbox(async ({ home, env }) => {
    const result = await runCli(['--platform', 'linkedin', '--discover-sources', '--now', '2026-06-04T12:00:00.000Z'], env);
    const sourcesPath = path.join(home, '.claude/state/social-evolve/linkedin/inspiration/sources.yaml');
    const rawDir = path.join(home, '.claude/state/social-evolve/linkedin/inspiration/_raw');
    const sourcesText = await readFile(sourcesPath, 'utf8');

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /bootstrap-log discover-sources platform=linkedin count=5/);
    assert.match(sourcesText, /access_mode: owner_paste/);
    await assert.rejects(() => readFile(path.join(rawDir, 'anything.jsonl')), /ENOENT/);
  });
});

test('underfilled coverage blocks direct bootstrap seeding and leaves voice unchanged', async () => {
  await withCliSandbox(async ({ home, env }) => {
    await writeSources(home);
    const voicePath = await writeVoice(home);
    const before = await readFile(voicePath, 'utf8');
    const rawDir = path.join(home, '.claude/state/social-evolve/threads/inspiration/_raw');
    await mkdir(rawDir, { recursive: true });
    await writeFile(path.join(rawDir, 'public-a.jsonl'), rawRows(19).join('\n'), 'utf8');

    const result = await runCli(['--platform', 'threads', '--min-engagement', '0', '--now', '2026-06-04T12:00:00.000Z'], env);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /voice benchmark coverage underfilled for threads: 19\/20/);
    assert.equal(await readFile(voicePath, 'utf8'), before);
  });
});

test('--allow-underfilled requires a reason and never permits direct bootstrap seed', async () => {
  await withCliSandbox(async ({ home, env }) => {
    await writeSources(home);
    const voicePath = await writeVoice(home);
    const before = await readFile(voicePath, 'utf8');
    const rawDir = path.join(home, '.claude/state/social-evolve/threads/inspiration/_raw');
    await mkdir(rawDir, { recursive: true });
    await writeFile(path.join(rawDir, 'public-a.jsonl'), rawRows(2).join('\n'), 'utf8');

    const missingReason = await runCli(['--platform', 'threads', '--dry-run', '--allow-underfilled'], env);
    assert.equal(missingReason.code, 1);
    assert.match(missingReason.stderr, /--allow-underfilled requires --reason/);

    const directSeed = await runCli([
      '--platform', 'threads',
      '--allow-underfilled',
      '--reason', 'manual research still in progress',
      '--min-engagement', '0',
      '--now', '2026-06-04T12:00:00.000Z',
    ], env);
    assert.equal(directSeed.code, 1);
    assert.match(directSeed.stderr, /underfilled coverage can only be used with --dry-run or --mode proposal/);
    assert.equal(await readFile(voicePath, 'utf8'), before);
  });
});
