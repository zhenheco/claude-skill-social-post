import assert from 'node:assert/strict';
import test from 'node:test';

import {
  UnsupportedFirecrawlTargetError,
  scrapeWithFirecrawl,
} from '../lib/voice-bootstrap/firecrawl-adapter.mjs';

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
  const result = await scrapeWithFirecrawl('https://example.com/post', {
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
  assert.match(calls[0][1], /^op:\/\/Dev\/FIRECRAWL_API\//);
  assert.equal(calls[1][1], 'https://api.firecrawl.dev/v2/scrape');
  assert.equal(calls[1][2], 'Bearer FAKE_TOKEN');
  assert.match(calls[1][3], /https:\/\/example\.com\/post/);
});
