import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MinerProfileError, run, sweepExpired } from '../lib/miner.mjs';

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
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-miner-home-'));
  const configPath = path.join(home, 'config.yaml');
  await writeFile(configPath, configTemplate(home), 'utf8');
  try {
    return await fn({ home, configPath, env: { HOME: home, SKILL_DIR: '.claude' } });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function rawFiles(home, platform) {
  const rawDir = path.join(home, '.claude/state/social-evolve', platform, 'inspiration/_raw');
  try {
    return await readdir(rawDir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function fileText(relativePath) {
  return readFile(path.join(process.cwd(), relativePath), 'utf8');
}

test('T2 run rejects logged-in or non-isolated mining profiles before capture', async () => {
  await withTempConfig(async ({ home, configPath, env }) => {
    const client = {
      profile: { loggedIn: true, isolated: true },
      ground: async () => {
        throw new Error('ground should not be called');
      },
      fetch: async () => {
        throw new Error('fetch should not be called');
      },
    };

    await assert.rejects(() => run({ platform: 'linkedin', client, env, configPath }), MinerProfileError);
    assert.deepEqual(await rawFiles(home, 'linkedin'), []);

    await assert.rejects(
      () =>
        run({
          platform: 'linkedin',
          client: { ...client, profile: { loggedIn: false, isolated: false } },
          env,
          configPath,
        }),
      MinerProfileError,
    );
    assert.deepEqual(await rawFiles(home, 'linkedin'), []);
  });
});

test('T3 run writes injected fetch results only to raw quarantine', async () => {
  await withTempConfig(async ({ home, configPath, env }) => {
    const calls = [];
    const client = {
      profile: { loggedIn: false, isolated: true },
      ground: async (query) => {
        calls.push(['ground', query.platform]);
        return [{ source_id: 'benchmark-account', url: 'https://example.invalid/post', access_mode: 'logged_out_webfetch' }];
      },
      fetch: async (url) => {
        calls.push(['fetch', url]);
        return 'Raw external post text with details that must stay quarantined.';
      },
    };
    const now = new Date('2026-06-03T10:00:00.000Z');

    const result = await run({ platform: 'linkedin', client, env, configPath, now });

    assert.equal(result.captured, 1);
    assert.deepEqual(calls, [
      ['ground', 'linkedin'],
      ['fetch', 'https://example.invalid/post'],
    ]);
    const files = await rawFiles(home, 'linkedin');
    assert.equal(files.length, 1);
    assert.match(files[0], /^2026-06-03T10-00-00\.000Z-benchmark-account\.json$/);

    const record = JSON.parse(
      await readFile(
        path.join(home, '.claude/state/social-evolve/linkedin/inspiration/_raw', files[0]),
        'utf8',
      ),
    );
    assert.equal(record.captured_at, '2026-06-03T10:00:00.000Z');
    assert.equal(record.ttl_expires_at, '2026-06-10T10:00:00.000Z');
    assert.equal(record.source_id, 'benchmark-account');
    assert.equal(record.access_mode, 'logged_out_webfetch');
    assert.equal(record.raw_text, 'Raw external post text with details that must stay quarantined.');
    assert.equal(existsSync(path.join(home, '.claude/state/social-evolve/linkedin/inspiration/linkedin.yaml')), false);
  });
});

test('T8 sweepExpired removes only raw captures past their TTL', async () => {
  await withTempConfig(async ({ home, configPath, env }) => {
    const rawDir = path.join(home, '.claude/state/social-evolve/linkedin/inspiration/_raw');
    await mkdir(rawDir, { recursive: true });
    await writeFile(
      path.join(rawDir, 'expired.json'),
      JSON.stringify({ ttl_expires_at: '2026-06-03T09:59:59.000Z', raw_text: 'old' }),
      'utf8',
    );
    await writeFile(
      path.join(rawDir, 'fresh.json'),
      JSON.stringify({ ttl_expires_at: '2026-06-03T10:00:01.000Z', raw_text: 'new' }),
      'utf8',
    );

    const purged = await sweepExpired({
      platform: 'linkedin',
      now: new Date('2026-06-03T10:00:00.000Z'),
      env,
      configPath,
    });

    assert.equal(purged, 1);
    assert.deepEqual((await rawFiles(home, 'linkedin')).sort(), ['fresh.json']);
  });
});

test('T6 generator and gate modules do not reference raw quarantine paths', async () => {
  const checked = [
    'lib/analyze.mjs',
    'lib/propose.mjs',
    'lib/propose-render.mjs',
    'lib/gates/decision.mjs',
    'lib/gates/diversity.mjs',
    'lib/gates/originality.mjs',
    'lib/gates/text-sim.mjs',
  ];
  const rawPathPattern = /inspiration[\\/]+_raw|[\\/]+_raw[\\/]+/;

  for (const file of checked) {
    assert.doesNotMatch(await fileText(file), rawPathPattern, file);
  }

  const publicSurface = `${await fileText('lib/miner.mjs')}\n${await fileText('lib/distill.mjs')}\n${await fileText('lib/sources.mjs')}`;
  assert.doesNotMatch(publicSurface, /export\s+(?:async\s+)?function\s+readRaw\b/);
});

test('T9 miner modules have no hardcoded home paths or inline secret literals', async () => {
  const source = `${await fileText('lib/miner.mjs')}\n${await fileText('lib/distill.mjs')}\n${await fileText('lib/sources.mjs')}`;
  const hardcodedPathPattern = new RegExp('/' + ['Users', 'home'].join('/|/') + '/');
  const secretPattern = /(?:api[_-]?key|secret|bearer\s+[A-Za-z0-9._-]{12,}|sk-[A-Za-z0-9]{12,})/i;

  assert.doesNotMatch(source, hardcodedPathPattern);
  assert.doesNotMatch(source, secretPattern);
});

test('T10 miner modules expose no browser automation, posting, or engagement code', async () => {
  const source = `${await fileText('lib/miner.mjs')}\n${await fileText('lib/distill.mjs')}\n${await fileText('lib/sources.mjs')}`;

  assert.doesNotMatch(source, /mcp__claude-in-chrome|Postiz|engagement|posting|click\s*\(/i);
});
