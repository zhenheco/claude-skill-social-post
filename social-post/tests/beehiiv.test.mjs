import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { BEEHIIV_KEY_REF, BeehiivClient } from '../lib/newsletter/beehiiv-client.mjs';
import { send } from '../lib/newsletter/beehiiv-send.mjs';
import {
  buildEditions,
  buildWelcomeSequence,
  prepareEditions,
  routeToList,
  toBeehiivDraft,
  relayWelcomeEmail,
} from '../lib/newsletter/editions.mjs';
import { parseUtm } from '../lib/attribution/utm.mjs';

const lists = Object.freeze({ zh: 'list-zh', en: 'list-en' });
const zhEdition = Object.freeze({
  source_edition_id: 'ed-zh-1',
  topic_id: 'topic-1',
  lang: 'zh',
  market_angle: 'tw_smb_outcome_roi',
  cta_kind: 'line_join',
  cta_target: 'https://line.example/join',
  subject: 'zh subject',
  text: 'zh body with Line CTA',
});
const enEdition = Object.freeze({
  source_edition_id: 'ed-en-1',
  topic_id: 'topic-1',
  lang: 'en',
  market_angle: 'technical_depth_build_in_public',
  cta_kind: 'newsletter_artifact',
  cta_target: 'https://artifact.example/newsletter',
  subject: 'en subject',
  text: 'en body with artifact CTA',
});

function makeFetchSpy() {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: `draft-${calls.length}` }),
        text: async () => 'ok',
      };
    },
  };
}

function makeOpSpy(value = 'TEST_SECRET') {
  const calls = [];
  return {
    calls,
    opRead: async (ref) => {
      calls.push(ref);
      return value;
    },
  };
}

function registry(mechanism = 'beehiiv_api_human_send') {
  const calls = [];
  return {
    calls,
    mechanismFor: (platform) => {
      calls.push(platform);
      return mechanism;
    },
  };
}

function mintUtm(input) {
  const params = new URLSearchParams();
  params.set('utm_source', input.channel);
  params.set('utm_medium', input.format);
  params.set('utm_campaign', input.topic_id);
  params.set('utm_content', input.thread);
  return params.toString();
}

test('routes zh and en transcreated editions to matching beehiiv lists and refuses cross-posting', () => {
  const zhList = routeToList('zh', zhEdition, { lists });
  const enList = routeToList('en', enEdition, { lists });

  assert.equal(zhList, lists.zh);
  assert.equal(enList, lists.en);
  assert.throws(() => routeToList('en', zhEdition, { lists }), /cross-post|firewall/i);
});

test('buildEditions preserves distinct market angles and CTA kinds', () => {
  const drafts = buildEditions({ emitted: [zhEdition, enEdition] }, { lists, mintUtm, now: () => '2026-06-03T00:00:00.000Z' });

  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].list_id, lists.zh);
  assert.equal(drafts[1].list_id, lists.en);
  assert.notEqual(drafts[0].market_angle, drafts[1].market_angle);
  assert.match(drafts[0].body, /line_join/);
  assert.match(drafts[1].body, /newsletter_artifact/);
});

test('prepareEditions creates drafts only and auto module does not export send', async () => {
  const fetchSpy = makeFetchSpy();
  const opSpy = makeOpSpy();
  const reg = registry();
  const client = new BeehiivClient({ fetchImpl: fetchSpy.fetchImpl, opRead: opSpy.opRead });
  const autoMod = await import('../lib/newsletter/editions.mjs');

  const result = await prepareEditions({ emitted: [zhEdition, enEdition] }, { client, lists, mintUtm, registry: reg, now: () => '2026-06-03T00:00:00.000Z' });

  assert.equal(typeof autoMod.send, 'undefined');
  assert.deepEqual(reg.calls, ['beehiiv']);
  assert.equal(result.length, 2);
  assert.equal(fetchSpy.calls.length, 2);
  assert.equal(fetchSpy.calls.every((call) => call.url.includes('/drafts')), true);
  assert.equal(fetchSpy.calls.some((call) => /send|publish/i.test(call.url)), false);
});

test('prepareEditions fails closed when registry rejects beehiiv mechanism', async () => {
  const fetchSpy = makeFetchSpy();
  const opSpy = makeOpSpy();
  const client = new BeehiivClient({ fetchImpl: fetchSpy.fetchImpl, opRead: opSpy.opRead });

  await assert.rejects(
    () => prepareEditions({ emitted: [zhEdition] }, { client, lists, registry: registry('browser') }),
    /unsupported mechanism/i,
  );
  assert.equal(fetchSpy.calls.length, 0);
});

test('human send is separate and requires an explicit human_confirm token', async () => {
  const fetchSpy = makeFetchSpy();
  const opSpy = makeOpSpy();
  const client = new BeehiivClient({ fetchImpl: fetchSpy.fetchImpl, opRead: opSpy.opRead });

  await assert.rejects(() => send({ id: 'draft-1' }, { client }), /human_confirm required/);
  await send({ id: 'draft-1' }, { client, human_confirm: 'human_confirm' });

  assert.equal(fetchSpy.calls.length, 1);
  assert.match(fetchSpy.calls[0].url, /draft-1\/send$/);
});

test('beehiiv client reads key via injected op reference and creates one draft write', async () => {
  const fetchSpy = makeFetchSpy();
  const opSpy = makeOpSpy();
  const client = new BeehiivClient({ fetchImpl: fetchSpy.fetchImpl, opRead: opSpy.opRead });
  const payload = toBeehiivDraft(zhEdition, lists.zh, 'utm_source=beehiiv', { now: () => '2026-06-03T00:00:00.000Z' });

  await client.createDraft(payload);

  assert.deepEqual(opSpy.calls, [BEEHIIV_KEY_REF]);
  assert.equal(BEEHIIV_KEY_REF, 'op://Dev/beehiiv API Key/credential');
  assert.equal(fetchSpy.calls.length, 1);
  assert.equal(fetchSpy.calls[0].init.method, 'POST');
  assert.equal(fetchSpy.calls[0].init.headers.Authorization, ['Bearer', 'TEST_SECRET'].join(' '));
});

test('welcome sequence carries issue-17 UTM fields and round-trips', () => {
  const welcome = buildWelcomeSequence(lists.zh, 'topic-1', {
    apexUrl: 'https://line.example/join',
    mintUtm,
  });

  const parsed = parseUtm(new URL(welcome.cta_url).search);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, {
    channel: 'beehiiv',
    format: 'welcome',
    topic_id: 'topic-1',
    thread: lists.zh,
  });
});

test('toBeehiivDraft is pure, immutable, and traceable', () => {
  const before = structuredClone(zhEdition);
  const draft = toBeehiivDraft(zhEdition, lists.zh, 'utm_source=beehiiv', { now: () => '2026-06-03T00:00:00.000Z' });

  assert.deepEqual(zhEdition, before);
  assert.notEqual(draft, zhEdition);
  for (const key of ['topic_id', 'lang', 'list_id', 'market_angle', 'utm', 'source_edition_id', 'ts']) {
    assert.ok(draft[key], key);
  }
});

test('welcome relay uses injected cf-email client only', async () => {
  const calls = [];
  const cfEmail = {
    send: async (payload) => {
      calls.push(payload);
      return { ok: true };
    },
  };

  await relayWelcomeEmail(
    { email: 'person@example.com', sequence: { subject: 'Welcome', body: 'Body', cta_url: 'https://line.example/join' } },
    { cfEmail },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, 'person@example.com');
});

test('newsletter source boundary has no auto send in auto flow, hardcoded paths, or raw secret literals', async () => {
  const root = new URL('..', import.meta.url);
  const autoSource = await readFile(new URL('../lib/newsletter/editions.mjs', import.meta.url), 'utf8');
  const clientSource = await readFile(new URL('../lib/newsletter/beehiiv-client.mjs', import.meta.url), 'utf8');
  const sendSource = await readFile(new URL('../lib/newsletter/beehiiv-send.mjs', import.meta.url), 'utf8');
  const testSource = await readFile(new URL('beehiiv.test.mjs', import.meta.url), 'utf8');
  const homePathLiteral = new RegExp('/(' + ['Users', 'home'].join('|') + ')/');
  const rawSecret = new RegExp(
    [
      ['s', 'k', '-'].join(''),
      ['A', 'K', 'I', 'A'].join(''),
      ['-----', 'BEGIN'].join(''),
      ['x', 'key', '_'].join(''),
    ].join('|'),
  );

  assert.doesNotMatch(autoSource, /\bsend\s*\(/);
  assert.match(sendSource, /human_confirm required/);
  for (const [name, source] of Object.entries({ autoSource, clientSource, sendSource, testSource })) {
    assert.doesNotMatch(source, homePathLiteral, name);
    assert.doesNotMatch(source, rawSecret, name);
  }
  assert.ok(root);
});
