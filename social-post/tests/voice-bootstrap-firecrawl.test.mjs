import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  UnsupportedFirecrawlTargetError,
  scrapeWithFirecrawl,
} from '../lib/voice-bootstrap/firecrawl-adapter.mjs';

async function configWith(content) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'social-post-firecrawl-'));
  const configPath = path.join(dir, 'config.yaml');
  await writeFile(configPath, content, 'utf8');
  return configPath;
}

test('firecrawl adapter refuses linkedin.com and threads.com targets before fetch or secret access', async () => {
  const calls = [];
  const deps = {
    fetch: async () => {
      calls.push('fetch');
      return { ok: true, json: async () => ({}) };
    },
    secret: () => {
      calls.push('secret');
      return 'FAKE_TOKEN';
    },
  };

  await assert.rejects(
    scrapeWithFirecrawl('https://www.linkedin.com/posts/example', deps),
    UnsupportedFirecrawlTargetError,
  );
  await assert.rejects(
    scrapeWithFirecrawl('https://www.threads.com/@example/post/1', deps),
    UnsupportedFirecrawlTargetError,
  );
  assert.deepEqual(calls, []);
});

test('firecrawl adapter uses injected fetch and secret for allowed targets', async () => {
  const calls = [];
  const firecrawlRef = 'op://Dev/FIRECRAWL_API/add more/jgu53dowhahoolxu53nsqlenga';
  const configPath = await configWith(`secrets:\n  firecrawl_api_key: ${firecrawlRef}\n`);
  const result = await scrapeWithFirecrawl('https://example.com/post', {
    configPath,
    secret: (ref) => {
      calls.push(['secret', ref]);
      return 'FAKE_TOKEN';
    },
    fetch: async (url, init) => {
      calls.push(['fetch', url, init.headers.authorization, init.body]);
      return {
        ok: true,
        json: async () => ({ data: { markdown: 'post text' } }),
      };
    },
  });

  assert.equal(result, 'post text');
  assert.equal(calls[0][0], 'secret');
  assert.equal(calls[0][1], firecrawlRef);
  assert.equal(calls[1][1], 'https://api.firecrawl.dev/v2/scrape');
  assert.equal(calls[1][2], 'Bearer FAKE_TOKEN');
  assert.match(calls[1][3], /https:\/\/example\.com\/post/);
});

test('firecrawl adapter forwards render wait and main-content options', async () => {
  const configPath = await configWith('secrets:\n  firecrawl_api_key: op://Dev/FIRECRAWL_API/credential\n');
  let body;

  await scrapeWithFirecrawl('https://example.com/blogspot-post', {
    configPath,
    secret: () => 'FAKE_TOKEN',
    waitFor: 4000,
    onlyMainContent: false,
    fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ data: { markdown: 'rendered post text' } }),
      };
    },
  });

  assert.deepEqual(body, {
    url: 'https://example.com/blogspot-post',
    formats: ['markdown'],
    waitFor: 4000,
    onlyMainContent: false,
  });
});

test('firecrawl adapter defaults to waitFor 4000 and full-page content', async () => {
  const configPath = await configWith('secrets:\n  firecrawl_api_key: op://Dev/FIRECRAWL_API/credential\n');
  let body;

  await scrapeWithFirecrawl('https://example.com/defaults', {
    configPath,
    secret: () => 'FAKE_TOKEN',
    fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ data: { markdown: 'rendered post text' } }),
      };
    },
  });

  assert.equal(body.waitFor, 4000);
  assert.equal(body.onlyMainContent, false);
});

test('firecrawl adapter throws a clear config error when firecrawl secret ref is absent', async () => {
  const configPath = await configWith('secrets:\n  other_key: op://Dev/OTHER/credential\n');

  await assert.rejects(
    scrapeWithFirecrawl('https://example.com/post', {
      configPath,
      secret: () => 'FAKE_TOKEN',
      fetch: async () => ({ ok: true, json: async () => ({ data: { markdown: 'post text' } }) }),
    }),
    /missing secrets\.firecrawl_api_key/u,
  );
});
