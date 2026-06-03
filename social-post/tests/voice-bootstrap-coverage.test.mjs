import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_MIN_SAMPLE_COUNT,
  CoverageError,
  assertCoverage,
  evaluateCoverage,
  writeCoverage,
} from '../lib/voice-bootstrap/coverage.mjs';
import { appendRaw } from '../lib/voice-bootstrap/raw-store.mjs';

const configText = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
  inspiration: \${HOME}/\${SKILL_DIR}/state/social-evolve/\${platform}/inspiration
  predictions_dir: \${HOME}/\${SKILL_DIR}/state/predictions
  decisions_file: \${HOME}/\${SKILL_DIR}/state/decisions-store.json
  voice_dir: \${HOME}/brands/personal/voice
`;

async function withCoverageSandbox(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'voice-coverage-'));
  const configPath = path.join(home, 'config.yaml');
  const env = { HOME: home, SKILL_DIR: '.claude', SOCIAL_POST_CONFIG_PATH: configPath };
  await writeFile(configPath, configText, 'utf8');
  try {
    return await fn({ home, env, configPath });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function writeSources(home, platform, sources) {
  const dir = path.join(home, `.claude/state/social-evolve/${platform}/inspiration`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'sources.yaml'), `sources:
${sources.map((source) => `  - source_id: ${source.source_id}
    trust: 0.6
    influence_cap: 0.2
    access_mode: ${source.access_mode}
    drift_flag: false`).join('\n')}
`, 'utf8');
}

function posts(count, engagement = { likes: 10 }) {
  return Array.from({ length: count }, (_, index) => ({
    text: `high engagement benchmark copy ${index + 1}`,
    engagement,
  }));
}

test('coverage requires 20 countable high-engagement examples by default', async () => {
  await withCoverageSandbox(async ({ home, env, configPath }) => {
    await writeSources(home, 'threads', [{ source_id: 'threads-a', access_mode: 'logged_out_webfetch' }]);
    await appendRaw('threads', 'threads-a', posts(19), { env, configPath, now: '2026-06-04T00:00:00.000Z' });

    const underfilled = await evaluateCoverage('threads', { env, configPath });
    assert.equal(DEFAULT_MIN_SAMPLE_COUNT, 20);
    assert.equal(underfilled.sample_count, 19);
    assert.equal(underfilled.ok, false);
    assert.throws(() => assertCoverage(underfilled), CoverageError);

    await appendRaw('threads', 'threads-a', posts(1), { env, configPath, now: '2026-06-04T00:00:00.000Z' });
    const ready = await evaluateCoverage('threads', { env, configPath });
    assert.equal(ready.sample_count, 20);
    assert.equal(ready.ok, true);
    assert.doesNotThrow(() => assertCoverage(ready));
  });
});

test('auth_required_deferred rows never count and owner_paste rows need engagement evidence', async () => {
  await withCoverageSandbox(async ({ home, env, configPath }) => {
    await writeSources(home, 'linkedin', [
      { source_id: 'native-login-wall', access_mode: 'auth_required_deferred' },
      { source_id: 'owner-paste-zero', access_mode: 'owner_paste' },
      { source_id: 'owner-paste-good', access_mode: 'owner_paste' },
    ]);
    await appendRaw('linkedin', 'native-login-wall', posts(20), { env, configPath, now: '2026-06-04T00:00:00.000Z' });
    await appendRaw('linkedin', 'owner-paste-zero', posts(20, { likes: 0, comments: 0, reposts: 0, shares: 0 }), {
      env,
      configPath,
      now: '2026-06-04T00:00:00.000Z',
    });
    await appendRaw('linkedin', 'owner-paste-good', posts(20, { likes: 1 }), {
      env,
      configPath,
      now: '2026-06-04T00:00:00.000Z',
    });

    const coverage = await evaluateCoverage('linkedin', { env, configPath });
    assert.equal(coverage.sample_count, 20);
    assert.equal(coverage.source_counts['native-login-wall'].counted, 0);
    assert.equal(coverage.source_counts['native-login-wall'].blocked_reason, 'auth_required_deferred');
    assert.equal(coverage.source_counts['owner-paste-zero'].counted, 0);
    assert.equal(coverage.source_counts['owner-paste-zero'].blocked_reason, 'missing_engagement_evidence');
    assert.equal(coverage.source_counts['owner-paste-good'].counted, 20);
    assert.equal(coverage.ok, true);
  });
});

test('writeCoverage stores coverage.json under the social platform inspiration directory', async () => {
  await withCoverageSandbox(async ({ home, env, configPath }) => {
    await writeSources(home, 'facebook', [{ source_id: 'facebook-a', access_mode: 'logged_out_webfetch' }]);
    await appendRaw('facebook', 'facebook-a', posts(20, { likes: 5, comments: 1 }), {
      env,
      configPath,
      now: '2026-06-04T00:00:00.000Z',
    });

    const result = await writeCoverage('facebook', { env, configPath, now: '2026-06-04T12:00:00.000Z' });
    const content = JSON.parse(await readFile(path.join(home, '.claude/state/social-evolve/facebook/inspiration/coverage.json'), 'utf8'));

    assert.equal(result.path, path.join(home, '.claude/state/social-evolve/facebook/inspiration/coverage.json'));
    assert.equal(content.platform, 'facebook');
    assert.equal(content.sample_count, 20);
    assert.equal(content.generated_at, '2026-06-04T12:00:00.000Z');
  });
});
