import assert from 'node:assert/strict';
import test from 'node:test';

import { attachUtm, mintUtm, parseUtm } from '../lib/attribution/utm.mjs';

test('T1 parseUtm reverses mintUtm for the attribution tuple', () => {
  const input = {
    channel: 'linkedin',
    thread: 't42',
    format: 'carousel',
    topic_id: 'tpc_001',
  };

  assert.deepEqual(parseUtm(mintUtm(input)), { ok: true, value: input });
});

test('T2 mintUtm is deterministic with fixed parameter order and no volatile tag', () => {
  const input = {
    channel: 'beehiiv',
    thread: 'welcome',
    format: 'newsletter',
    topic_id: 'topic-001',
  };

  const first = mintUtm(input);
  const second = mintUtm(input);

  assert.equal(first, second);
  assert.equal(first, 'utm_source=beehiiv&utm_medium=newsletter&utm_campaign=topic-001&utm_content=welcome');
  assert.doesNotMatch(first, /\d{4}-\d{2}-\d{2}|random|nonce|ts=/i);
});

test('T5 mintUtm and parseUtm preserve URL-unsafe topic and thread values', () => {
  const input = {
    channel: 'vocus',
    thread: 'thread:zh/tw launch',
    format: 'article',
    topic_id: 'topic:ai/導入 001',
  };

  assert.deepEqual(parseUtm(mintUtm(input)), { ok: true, value: input });
});

test('T6 mintUtm and parseUtm are pure and return new values', () => {
  const input = Object.freeze({
    channel: 'devto',
    thread: 'canonical',
    format: 'article',
    topic_id: 'topic-immutable',
  });
  const expected = { ...input };

  const utm = mintUtm(input);
  const parsedA = parseUtm(utm);
  const parsedB = parseUtm(utm);

  assert.equal(typeof utm, 'string');
  assert.deepEqual(input, expected);
  assert.notEqual(parsedA.value, input);
  assert.notEqual(parsedA.value, parsedB.value);
  assert.deepEqual(parsedA, parsedB);
});

test('T3 attachUtm preserves existing query and works for Line join and consult URLs', () => {
  const utm = mintUtm({
    channel: 'threads',
    thread: 'thread-cta',
    format: 'shortpost',
    topic_id: 'topic-cta',
  });

  const lineUrl = attachUtm('https://line.me/ti/g2/abc?x=1', utm);
  const consultUrl = attachUtm('https://example.com/consult?locale=zh-tw', utm);

  assert.equal(
    lineUrl,
    'https://line.me/ti/g2/abc?x=1&utm_source=threads&utm_medium=shortpost&utm_campaign=topic-cta&utm_content=thread-cta',
  );
  assert.equal(
    consultUrl,
    'https://example.com/consult?locale=zh-tw&utm_source=threads&utm_medium=shortpost&utm_campaign=topic-cta&utm_content=thread-cta',
  );
});

test('T4 parseUtm rejects malformed non-mesh UTM without throwing', () => {
  const result = parseUtm('utm_source=foo');

  assert.equal(result.ok, false);
  assert.match(result.error, /missing.*(thread|format|topic_id)/i);
});
