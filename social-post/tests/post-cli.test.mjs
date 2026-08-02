import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { main } from '../scripts/post.mjs';

test('post CLI continues with text posting when lazy image generation fails', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'social-post-cli-'));
  const draftPath = path.join(dir, 'draft.txt');
  await writeFile(draftPath, 'tweet text', 'utf8');
  try {
    const payloads = [];
    const output = [];
    await main(['--platform', 'x', '--draft', draftPath, '--now', '--image'], { POSTIZ_API_KEY: 'TEST' }, {
      now: () => new Date('2026-06-09T00:00:00.000Z'),
      console: { log: (line) => output.push(line), error: () => {} },
      generateImage: async () => {
        throw new Error('codex unavailable');
      },
      createClient: () => ({
        listIntegrations: async () => [{ identifier: 'x', name: 'test account', id: 'x-channel', disabled: false }],
        createPost: async (payload) => {
          payloads.push(payload);
          return { id: 'post-1' };
        },
      }),
    });

    assert.equal(payloads.length, 1);
    assert.deepEqual(payloads[0].posts[0].value, [{ content: 'tweet text', image: [] }]);
    assert.match(output[0], /post-1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('post CLI refuses Facebook personal posting after saving requested image', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'social-post-cli-fb-'));
  const draftPath = path.join(dir, 'draft.txt');
  const pngPath = path.join(dir, 'assets/draft.png');
  await writeFile(draftPath, 'facebook draft', 'utf8');
  try {
    let generated = false;
    await assert.rejects(
      () => main(['--platform', 'facebook', '--draft', draftPath, '--image'], {}, {
        generateImage: async () => {
          generated = true;
          return { pngPath };
        },
        createClient: () => {
          throw new Error('should not create Postiz client for Facebook');
        },
      }),
      /facebook personal = attended only; image saved to .*draft\.png for manual attach/,
    );
    assert.equal(generated, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('post CLI --dry-run generates image and previews payload without uploading or sending', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'social-post-cli-dry-'));
  const draftPath = path.join(dir, 'draft.txt');
  await writeFile(draftPath, 'tweet text', 'utf8');
  try {
    const output = [];
    let createPostCalled = false;
    let uploadCalled = false;
    let generated = false;
    await main(['--platform', 'x', '--draft', draftPath, '--now', '--image', '--dry-run'], { POSTIZ_API_KEY: 'TEST' }, {
      now: () => new Date('2026-06-09T00:00:00.000Z'),
      console: { log: (line) => output.push(line), error: () => {} },
      generateImage: async () => { generated = true; return { pngPath: path.join(dir, 'assets/draft.png') }; },
      createClient: () => ({
        listIntegrations: async () => [{ identifier: 'x', name: 'test account', id: 'x-channel', disabled: false }],
        uploadMedia: async () => { uploadCalled = true; return { id: 'm', path: 'p' }; },
        createPost: async () => { createPostCalled = true; return { id: 'post-1' }; },
      }),
    });
    const preview = JSON.parse(output[0]);
    assert.equal(preview.dryRun, true);
    assert.equal(preview.channelId, 'x-channel');
    assert.equal(preview.type, 'now');
    assert.match(preview.imagePath, /draft\.png/);
    assert.equal(generated, true);
    assert.equal(uploadCalled, false);
    assert.equal(createPostCalled, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('post CLI --image-path reuses a pre-generated image without regenerating', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'social-post-cli-imgpath-'));
  const draftPath = path.join(dir, 'draft.txt');
  const pngPath = path.join(dir, 'pre.png');
  await writeFile(draftPath, 'tweet text', 'utf8');
  try {
    const payloads = [];
    let generated = false;
    let uploadedPath = null;
    await main(['--platform', 'x', '--draft', draftPath, '--now', '--image-path', pngPath], { POSTIZ_API_KEY: 'TEST' }, {
      now: () => new Date('2026-06-09T00:00:00.000Z'),
      console: { log: () => {}, error: () => {} },
      generateImage: async () => { generated = true; return { pngPath: 'WRONG' }; },
      createClient: () => ({
        listIntegrations: async () => [{ identifier: 'x', name: 'test account', id: 'x-channel', disabled: false }],
        uploadMedia: async (p) => { uploadedPath = p; return { id: 'm', path: 'p' }; },
        createPost: async (payload) => { payloads.push(payload); return { id: 'post-1' }; },
      }),
    });
    assert.equal(generated, false);
    assert.equal(uploadedPath, pngPath);
    assert.equal(payloads.length, 1);
    assert.deepEqual(payloads[0].posts[0].value[0].image, [{ id: 'm', path: 'p' }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('post CLI resolves a live channel when optional channels.json is missing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'social-post-cli-live-'));
  const draftPath = path.join(dir, 'draft.txt');
  const missingChannelsPath = path.join(dir, 'missing-channels.json');
  await writeFile(draftPath, 'live channel draft', 'utf8');
  try {
    const output = [];
    await main(['--platform', 'x', '--draft', draftPath, '--now', '--dry-run'], {
      POSTIZ_API_KEY: 'TEST',
      SOCIAL_POST_CHANNELS_JSON: missingChannelsPath,
    }, {
      console: { log: (line) => output.push(line), error: () => {} },
      createClient: () => ({
        listIntegrations: async () => [{ identifier: 'x', name: 'test account', id: 'live-x-channel', disabled: false }],
      }),
    });

    assert.equal(JSON.parse(output[0]).channelId, 'live-x-channel');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('post CLI explains how to create channels.json when live and fallback channels are absent', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'social-post-cli-no-channels-'));
  const draftPath = path.join(dir, 'draft.txt');
  const missingChannelsPath = path.join(dir, 'missing-channels.json');
  await writeFile(draftPath, 'missing channel draft', 'utf8');
  try {
    await assert.rejects(
      () => main(['--platform', 'linkedin', '--draft', draftPath, '--now', '--dry-run'], {
        POSTIZ_API_KEY: 'TEST',
        SOCIAL_POST_CHANNELS_JSON: missingChannelsPath,
      }, {
        createClient: () => ({ listIntegrations: async () => [] }),
      }),
      /no Postiz channel found for linkedin.*create.*channels\.json.*identifier.*id/i,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
