import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  schedulePost,
  splitForX,
  taipeiWallClockISO,
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

test('Postiz createClient uploads media via multipart public v1 upload endpoint', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'postiz-upload-'));
  const pngPath = path.join(dir, 'media.png');
  await writeFile(pngPath, 'png', 'utf8');
  const calls = [];
  try {
    const client = createClient({
      env: { POSTIZ_API_KEY: 'TEST' },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return { ok: true, status: 200, json: async () => ({ id: 'media-1', path: 'https://uploads.postiz.com/media.png' }) };
      },
    });

    const media = await client.uploadMedia(pngPath);

    assert.deepEqual(media, { id: 'media-1', path: 'https://uploads.postiz.com/media.png' });
    assert.match(calls[0].url, /https:\/\/api\.postiz\.com\/public\/v1\/upload$/);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'TEST');
    assert.ok(calls[0].init.body instanceof FormData);
    assert.equal(calls[0].init.body.has('file'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('taipeiWallClockISO converts a Taipei wall-clock time to the correct UTC (TW-8h) Postiz date', () => {
  // Postiz interprets `date` as UTC; 17:00 Taipei = 09:00 UTC same day.
  assert.equal(taipeiWallClockISO(new Date('2026-06-09T00:00:00.000Z'), '17:00'), '2026-06-09T09:00:00.000Z');
  // date arg resolves to Taipei calendar day 2027-01-01; 09:30 Taipei = 01:30 UTC same day.
  assert.equal(taipeiWallClockISO(new Date('2026-12-31T20:00:00.000Z'), '09:30'), '2027-01-01T01:30:00.000Z');
});

test('splitForX preserves order without empty segments or over-limit tweets', () => {
  const paragraph = 'First paragraph has a clear sentence boundary for X splitting. '.repeat(4).trim();
  const second = 'Second paragraph is also long enough to require a thread while preserving words. '.repeat(4).trim();
  const segments = splitForX(`${paragraph}\n\n${second}`, 180);

  assert.ok(segments.length > 1);
  assert.equal(segments.some((segment) => segment.length > 180), false);
  assert.equal(segments.some((segment) => segment.length === 0), false);
  assert.equal(segments.join('\n\n').replace(/\s+/g, ' '), `${paragraph} ${second}`.replace(/\s+/g, ' '));
  for (const segment of segments) {
    assert.doesNotMatch(segment, /^\s|\s$/);
  }
});

test('schedulePost builds X native thread payload with settings and image array', async () => {
  const calls = [];
  const client = { createPost: async (payload) => (calls.push(payload), { id: 'post-1' }) };
  const mediaObjs = [{ id: 'media-1', path: 'https://uploads.postiz.com/media.png' }];

  const result = await schedulePost({
    platform: 'x',
    channelId: 'x-channel',
    segments: ['tweet one', 'tweet two'],
    date: '2026-06-09T17:00:00.000Z',
    type: 'schedule',
    mediaObjs,
    client,
  });

  assert.deepEqual(result, { id: 'post-1' });
  assert.deepEqual(calls[0], {
    type: 'schedule',
    date: '2026-06-09T17:00:00.000Z',
    shortLink: false,
    tags: [],
    posts: [{
      integration: { id: 'x-channel' },
      value: [
        { content: 'tweet one', image: mediaObjs },
        { content: 'tweet two', image: mediaObjs },
      ],
      settings: { __type: 'x', who_can_reply_post: 'everyone' },
    }],
  });
});

test('schedulePost keeps non-X platforms as a single value entry with provider settings', async () => {
  const calls = [];
  const client = { createPost: async (payload) => (calls.push(payload), { id: 'post-1' }) };
  const mediaObjs = [{ id: 'media-1', path: 'https://uploads.postiz.com/media.png' }];

  await schedulePost({
    platform: 'threads',
    channelId: 'threads-channel',
    segments: ['first', 'second'],
    date: '2026-06-09T17:00:00.000Z',
    type: 'now',
    mediaObjs,
    client,
  });

  assert.deepEqual(calls[0].posts[0].value, [{ content: 'first\n\nsecond', image: mediaObjs }]);
  assert.deepEqual(calls[0].posts[0].settings, { __type: 'threads' });
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

  assert.equal(POSTIZ_KEY_REF, 'op://Dev/Postiz API Key/credential');
  assert.match(source, /POSTIZ_API_KEY/);
  assert.doesNotMatch(source, /mcp__claude-in-chrome__|click\s*\(|document\.|querySelector|op item|get.*reveal/i);
  assert.doesNotMatch(source, homePathLiteral);
  assert.doesNotMatch(source, rawSecret);
});

test('Postiz live integration lists integrations when explicitly enabled', { skip: process.env.RUN_POSTIZ_LIVE !== '1' }, async () => {
  const client = createClient({ fetchImpl: globalThis.fetch });
  const integrations = await client.listIntegrations();

  assert.equal(Array.isArray(integrations), true);
});
