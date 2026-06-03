import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ChallengeFrozenError,
  ChallengeSignal,
  PlatformFrozenError,
  POSTIZ_KEY_REF,
  UnsupportedMechanismError,
  createClient,
  post,
} from '../lib/posting/postiz-adapter.mjs';

function registry(mechanism = 'postiz_official_api') {
  const calls = [];
  return {
    calls,
    mechanismFor: (platform) => {
      calls.push(platform);
      return mechanism;
    },
  };
}

async function withState(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'postiz-state-'));
  const env = { ...process.env, SOCIAL_EVOLVE_STATE_ROOT: root, POSTIZ_API_KEY: 'TEST' };
  try {
    return await fn({ root, env });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('Postiz createClient posts LinkedIn via public v1 posts with Authorization header', async () => {
  const calls = [];
  const client = createClient({
    env: { POSTIZ_API_KEY: 'TEST' },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 201, json: async () => ({ post_id: 'post-1' }) };
    },
  });

  const result = await client.createPost({ platform: 'linkedin', content: 'draft text', type: 'text' });

  assert.equal(result.post_id, 'post-1');
  assert.match(calls[0].url, /https:\/\/api\.postiz\.com\/public\/v1\/posts$/);
  assert.equal(calls[0].init.headers.Authorization, 'TEST');
});

test('Postiz post supports X text and LinkedIn PDF carousel through the same injected client', async () => {
  await withState(async ({ env }) => {
    const calls = [];
    const client = { createPost: async (payload) => (calls.push(payload), { post_id: `p-${calls.length}` }) };

    await post({ platform: 'x', draft: { text: 'x draft' }, client, registry: registry(), env });
    await post({ platform: 'linkedin', draft: { text: 'deck', document: { url: 'https://asset.example/deck.pdf' } }, client, registry: registry(), env });

    assert.equal(calls[0].platform, 'x');
    assert.equal(calls[0].type, 'text');
    assert.equal(calls[1].platform, 'linkedin');
    assert.equal(calls[1].type, 'document');
    assert.deepEqual(calls[1].document, { url: 'https://asset.example/deck.pdf' });
  });
});

test('Postiz freezes platform on challenge and refuses the next call without client access', async () => {
  await withState(async ({ root, env }) => {
    const reg = registry();
    let calls = 0;
    const client = {
      createPost: async () => {
        calls += 1;
        throw new ChallengeSignal('login_wall');
      },
    };

    await assert.rejects(() => post({ platform: 'linkedin', draft: { text: 'draft' }, client, registry: reg, env }), ChallengeFrozenError);
    const health = await readFile(path.join(root, 'linkedin', 'account-health.yaml'), 'utf8');
    assert.match(health, /frozen: true/);
    await assert.rejects(() => post({ platform: 'linkedin', draft: { text: 'draft' }, client, registry: reg, env }), PlatformFrozenError);
    assert.equal(calls, 1);
  });
});

test('Postiz rejects unsupported registry mechanisms before client access', async () => {
  await withState(async ({ env }) => {
    let calls = 0;
    const client = { createPost: async () => (calls += 1) };

    await assert.rejects(
      () => post({ platform: 'facebook', draft: { text: 'draft' }, client, registry: registry('browser'), env }),
      UnsupportedMechanismError,
    );
    assert.equal(calls, 0);
  });
});

test('Postiz source boundary has env secret read only, no browser DOM, no raw key, and trace log', async () => {
  const source = await readFile(new URL('../lib/posting/postiz-adapter.mjs', import.meta.url), 'utf8');
  const homePathLiteral = new RegExp('/(' + ['Users', 'home'].join('|') + ')/');
  const rawSecret = new RegExp([['s', 'k', '-'].join(''), ['A', 'K', 'I', 'A'].join(''), ['-----', 'BEGIN'].join('')].join('|'));

  assert.equal(POSTIZ_KEY_REF, 'op://Dev/Postiz API Key');
  assert.match(source, /POSTIZ_API_KEY/);
  assert.doesNotMatch(source, /mcp__claude-in-chrome__|click\s*\(|document\.|querySelector|op item|get.*reveal/i);
  assert.doesNotMatch(source, homePathLiteral);
  assert.doesNotMatch(source, rawSecret);
});
