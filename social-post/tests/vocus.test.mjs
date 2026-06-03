import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CrossPostFirewallError } from '../lib/cross-post-firewall.mjs';
import { VOCUS_KEY_REF, prepare, submitDraft } from '../lib/publish/vocus-adapter.mjs';
import { parseUtm } from '../lib/attribution/utm.mjs';

const zhEdition = Object.freeze({
  topic_id: 'topic-vocus',
  lang: 'zh',
  title: 'Vocus title',
  text: 'Vocus body',
  canonical_url: 'https://owned.example/zh/topic-vocus',
  thread: 'vocus-thread',
  format: 'article',
  tags: ['ai'],
});
const enEdition = Object.freeze({ ...zhEdition, lang: 'en' });

function registry(mechanism = 'vocus_publish_adapter_1click') {
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
      if (edition.lang !== 'zh') throw new CrossPostFirewallError({ edition_lang: edition.lang, surface_lang: 'zh', surface });
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
      return { ok: true, status: 201, body: { id: 'vocus-draft-id' } };
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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vocus-log-'));
  const logPath = path.join(dir, 'publish-log.jsonl');
  try {
    return await fn(logPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('vocus prepare emits a draft carrying canonical URL and Line UTM', () => {
  const reg = registry();
  const gate = firewall();
  const draft = prepare(zhEdition, { registry: reg, firewall: gate, lineJoinUrl: 'https://line.example/join' });

  assert.equal(draft.status, 'draft');
  assert.equal(draft.published, false);
  assert.match(draft.payload.body, /https:\/\/owned\.example\/zh\/topic-vocus/);
  assert.match(draft.payload.body, /utm_source=vocus/);
  assert.match(draft.human_publish_url, /^https:\/\/vocus\.cc/);
  assert.equal(reg.calls[0], 'vocus');
  assert.equal(gate.calls[0].surface, 'vocus');
  const parsed = parseUtm(new URL(draft.utm).search);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.channel, 'vocus');
  assert.equal(parsed.value.topic_id, zhEdition.topic_id);
});

test('vocus has no auto-publish export and submitDraft posts draft status only', async () => {
  await withLog(async (logPath) => {
    const http = httpSpy();
    const secrets = secretSpy();
    const draft = prepare(zhEdition, { registry: registry(), firewall: firewall(), lineJoinUrl: 'https://line.example/join' });
    const result = await submitDraft(draft, { httpClient: http.httpClient, secretReader: secrets.secretReader, logPath });
    const mod = await import('../lib/publish/vocus-adapter.mjs');
    const lines = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

    assert.equal(typeof mod.publish, 'undefined');
    assert.equal(typeof mod.send, 'undefined');
    assert.equal(result.published, false);
    assert.equal(secrets.calls[0], VOCUS_KEY_REF);
    assert.equal(VOCUS_KEY_REF, 'op://Dev/Vocus API Key/credential');
    assert.equal(http.calls[0].method, 'POST');
    assert.equal(http.calls[0].body.status, 'draft');
    assert.equal(http.calls[0].body.published, false);
    assert.equal(lines[0].surface, 'vocus');
    assert.equal(lines[0].published, false);
    assert.equal(lines[0].status, 'draft');
  });
});

test('vocus rejects en editions and unsupported registry mechanisms before HTTP', async () => {
  assert.throws(() => prepare(enEdition, { registry: registry(), firewall: firewall(), lineJoinUrl: 'https://line.example/join' }), CrossPostFirewallError);
  assert.throws(
    () => prepare(zhEdition, { registry: registry('excluded'), firewall: firewall(), lineJoinUrl: 'https://line.example/join' }),
    /unsupported mechanism/i,
  );
});

test('vocus source hygiene has no hardcoded paths, raw token literals, or auto-send API', async () => {
  const source = await readFile(new URL('../lib/publish/vocus-adapter.mjs', import.meta.url), 'utf8');
  const testSource = await readFile(new URL('vocus.test.mjs', import.meta.url), 'utf8');
  const homePathLiteral = new RegExp('/(' + ['Users', 'home'].join('|') + ')/');
  const rawSecret = new RegExp([['s', 'k', '-'].join(''), ['Bearer', ' '].join(''), ['A', 'K', 'I', 'A'].join('')].join('|'));

  for (const text of [source, testSource]) {
    assert.doesNotMatch(text, homePathLiteral);
    assert.doesNotMatch(text, rawSecret);
  }
  assert.doesNotMatch(source, /\bpublish\s*\(/);
  assert.doesNotMatch(source, /\bsend\s*\(/);
}
);
