import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CrossPostFirewallError } from '../lib/cross-post-firewall.mjs';
import { DEVTO_KEY_REF, NotRepublishError, republish, submitDraft } from '../lib/publish/devto-adapter.mjs';

const ownedRef = Object.freeze({
  topic_id: 'topic-devto',
  lang: 'en',
  title: 'Owned article',
  canonical_url: 'https://owned.example/en/topic-devto',
  body_markdown: 'Original owned article content',
  tags: ['ai'],
});
const zhRef = Object.freeze({ ...ownedRef, lang: 'zh' });

function registry(mechanism = 'devto_canonical_spoke') {
  const calls = [];
  return {
    calls,
    mechanismFor: (surface) => {
      calls.push(surface);
      return mechanism;
    },
  };
}

function firewall() {
  const calls = [];
  return {
    calls,
    assertSameStack: (edition, surface) => {
      calls.push({ edition, surface });
      if (edition.lang !== 'en') throw new CrossPostFirewallError({ edition_lang: edition.lang, surface_lang: 'en', surface });
      return true;
    },
  };
}

function httpSpy() {
  const calls = [];
  return {
    calls,
    httpClient: async (request) => {
      calls.push(request);
      return { ok: true, status: 201, body: { id: 'devto-draft-id' } };
    },
  };
}

function secretSpy() {
  const calls = [];
  return {
    calls,
    secretReader: async (ref) => {
      calls.push(ref);
      return 'TEST';
    },
  };
}

async function withLog(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'devto-log-'));
  const logPath = path.join(dir, 'publish-log.jsonl');
  try {
    return await fn(logPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('Dev.to republish builds a canonical draft from an owned article only', () => {
  const reg = registry();
  const gate = firewall();
  const draft = republish(ownedRef, { registry: reg, firewall: gate, ownedDomains: ['owned.example'] });

  assert.equal(draft.status, 'draft');
  assert.equal(draft.published, false);
  assert.equal(draft.payload.article.canonical_url, ownedRef.canonical_url);
  assert.equal(draft.payload.article.body_markdown, ownedRef.body_markdown);
  assert.equal(draft.payload.article.published, false);
  assert.equal(reg.calls[0], 'devto');
  assert.equal(gate.calls[0].surface, 'devto');
});

test('Dev.to refuses free-text, non-owned, and zh inputs', () => {
  assert.throws(() => republish({ title: 'new post', body_markdown: 'free text', lang: 'en' }, { registry: registry(), firewall: firewall(), ownedDomains: ['owned.example'] }), NotRepublishError);
  assert.throws(() => republish({ ...ownedRef, canonical_url: 'https://not-owned.example/post' }, { registry: registry(), firewall: firewall(), ownedDomains: ['owned.example'] }), NotRepublishError);
  assert.throws(() => republish(zhRef, { registry: registry(), firewall: firewall(), ownedDomains: ['owned.example'] }), CrossPostFirewallError);
});

test('Dev.to submitDraft posts only /articles draft and never comments', async () => {
  await withLog(async (logPath) => {
    const http = httpSpy();
    const secrets = secretSpy();
    const draft = republish(ownedRef, { registry: registry(), firewall: firewall(), ownedDomains: ['owned.example'] });
    const result = await submitDraft(draft, { httpClient: http.httpClient, secretReader: secrets.secretReader, logPath });
    const lines = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

    assert.equal(result.published, false);
    assert.equal(secrets.calls[0], DEVTO_KEY_REF);
    assert.equal(DEVTO_KEY_REF, 'op://Dev/DevTo API Key/credential');
    assert.equal(http.calls.length, 1);
    assert.match(http.calls[0].url, /\/articles$/);
    assert.doesNotMatch(http.calls[0].url, /comments/);
    assert.equal(http.calls[0].body.article.published, false);
    assert.equal(lines[0].surface, 'devto');
    assert.equal(lines[0].canonical_url, ownedRef.canonical_url);
  });
});

test('Dev.to fails closed on unsupported registry mechanism', () => {
  assert.throws(
    () => republish(ownedRef, { registry: registry('browser'), firewall: firewall(), ownedDomains: ['owned.example'] }),
    /unsupported mechanism/i,
  );
});

test('Dev.to source hygiene has no comment endpoint, hardcoded paths, raw token literals, or publish export', async () => {
  const source = await readFile(new URL('../lib/publish/devto-adapter.mjs', import.meta.url), 'utf8');
  const mod = await import('../lib/publish/devto-adapter.mjs');
  const homePathLiteral = new RegExp('/(' + ['Users', 'home'].join('|') + ')/');
  const rawSecret = new RegExp([['s', 'k', '-'].join(''), ['Bearer', ' '].join(''), ['A', 'K', 'I', 'A'].join('')].join('|'));

  assert.equal(typeof mod.publish, 'undefined');
  assert.equal(typeof mod.send, 'undefined');
  assert.doesNotMatch(source, homePathLiteral);
  assert.doesNotMatch(source, rawSecret);
  assert.doesNotMatch(source, /comments/i);
});
