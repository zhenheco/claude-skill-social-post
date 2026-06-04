import assert from 'node:assert/strict';
import test from 'node:test';

import { createClient, PUBLISH_PLATFORMS } from '../lib/autopost/client.mjs';

const apiKeyRef = 'op://Dev/autopost API Key/credential';
const fakeKey = 'apb_FAKE';

function makeJsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function makeFetchSpy(response = makeJsonResponse({ ok: true })) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return response;
    },
  };
}

function makeSecretSpy(value = fakeKey) {
  const calls = [];
  return {
    calls,
    secretImpl: (ref) => {
      calls.push(ref);
      return value;
    },
  };
}

function makeClient({ fetchImpl, secretImpl } = {}) {
  return createClient({
    baseUrl: 'https://autopost.example',
    apiKeyRef,
    fetchImpl,
    secretImpl,
  });
}

test('exports the official autopost publish platforms immutably', () => {
  assert.deepEqual(PUBLISH_PLATFORMS, ['facebook', 'instagram', 'threads']);
  assert.equal(Object.isFrozen(PUBLISH_PLATFORMS), true);
});

test('publish without human confirmation throws before fetch', async () => {
  const fetchSpy = makeFetchSpy();
  const secretSpy = makeSecretSpy();
  const client = makeClient({ fetchImpl: fetchSpy.fetchImpl, secretImpl: secretSpy.secretImpl });

  await assert.rejects(
    () => client.publish({ platform: 'facebook', content: 'Draft' }),
    /human_confirm required/,
  );

  assert.equal(fetchSpy.calls.length, 0);
  assert.equal(secretSpy.calls.length, 0);
});

test('publish rejects unsupported platforms before fetch', async () => {
  for (const platform of ['linkedin', 'x', 'reddit']) {
    const fetchSpy = makeFetchSpy();
    const secretSpy = makeSecretSpy();
    const client = makeClient({ fetchImpl: fetchSpy.fetchImpl, secretImpl: secretSpy.secretImpl });

    await assert.rejects(
      () => client.publish({ platform, content: 'Draft' }, { confirm: 'human_confirm' }),
      new RegExp(`unsupported platform: ${platform}`),
    );

    assert.equal(fetchSpy.calls.length, 0);
    assert.equal(secretSpy.calls.length, 0);
  }
});

test('publish posts official platforms with bearer auth and JSON body', async () => {
  for (const platform of PUBLISH_PLATFORMS) {
    const fetchSpy = makeFetchSpy(makeJsonResponse({ id: `${platform}-post` }, { status: 201 }));
    const secretSpy = makeSecretSpy();
    const client = makeClient({ fetchImpl: fetchSpy.fetchImpl, secretImpl: secretSpy.secretImpl });

    const result = await client.publish(
      { platform, content: `${platform} content`, mediaUrls: ['https://cdn.example/image.jpg'] },
      { confirm: 'human_confirm' },
    );

    assert.deepEqual(result, { id: `${platform}-post` });
    assert.equal(fetchSpy.calls.length, 1);
    assert.equal(fetchSpy.calls[0].url.endsWith('/api/posts'), true);
    assert.equal(fetchSpy.calls[0].init.method, 'POST');
    assert.equal(fetchSpy.calls[0].init.headers.Authorization, `Bearer ${fakeKey}`);
    assert.equal(fetchSpy.calls[0].init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(fetchSpy.calls[0].init.body), {
      platform,
      content: `${platform} content`,
      mediaUrls: ['https://cdn.example/image.jpg'],
    });
  }
});

test('publish non-2xx errors include status without leaking bearer key', async () => {
  const fetchSpy = makeFetchSpy(makeJsonResponse({ detail: `do not leak ${fakeKey}` }, { ok: false, status: 403 }));
  const secretSpy = makeSecretSpy();
  const client = makeClient({ fetchImpl: fetchSpy.fetchImpl, secretImpl: secretSpy.secretImpl });

  await assert.rejects(
    () => client.publish({ platform: 'facebook', content: 'Draft' }, { confirm: 'human_confirm' }),
    (error) => {
      assert.equal(error.message, 'autopost publish failed: 403');
      assert.equal(error.message.includes(fakeKey), false);
      return true;
    },
  );
});

test('listAccounts gets social accounts with bearer auth', async () => {
  const fetchSpy = makeFetchSpy(makeJsonResponse([{ id: 'acct-1' }]));
  const secretSpy = makeSecretSpy();
  const client = makeClient({ fetchImpl: fetchSpy.fetchImpl, secretImpl: secretSpy.secretImpl });

  const result = await client.listAccounts();

  assert.deepEqual(result, [{ id: 'acct-1' }]);
  assert.equal(fetchSpy.calls.length, 1);
  assert.equal(fetchSpy.calls[0].url, 'https://autopost.example/api/social-accounts');
  assert.equal(fetchSpy.calls[0].init.method, 'GET');
  assert.equal(fetchSpy.calls[0].init.headers.Authorization, `Bearer ${fakeKey}`);
});

test('analytics gets aggregate metrics with query params and bearer auth', async () => {
  const fetchSpy = makeFetchSpy(makeJsonResponse({ impressions: 42 }));
  const secretSpy = makeSecretSpy();
  const client = makeClient({ fetchImpl: fetchSpy.fetchImpl, secretImpl: secretSpy.secretImpl });

  const result = await client.analytics({ platform: 'threads', limit: 10 });

  assert.deepEqual(result, { impressions: 42 });
  assert.equal(fetchSpy.calls.length, 1);
  assert.equal(fetchSpy.calls[0].url, 'https://autopost.example/api/analytics?platform=threads&limit=10');
  assert.equal(fetchSpy.calls[0].init.method, 'GET');
  assert.equal(fetchSpy.calls[0].init.headers.Authorization, `Bearer ${fakeKey}`);
});

test('insights gets per-post metrics with bearer auth', async () => {
  const fetchSpy = makeFetchSpy(makeJsonResponse({ postId: 'post-1', likes: 7 }));
  const secretSpy = makeSecretSpy();
  const client = makeClient({ fetchImpl: fetchSpy.fetchImpl, secretImpl: secretSpy.secretImpl });

  const result = await client.insights('post-1');

  assert.deepEqual(result, { postId: 'post-1', likes: 7 });
  assert.equal(fetchSpy.calls.length, 1);
  assert.equal(fetchSpy.calls[0].url, 'https://autopost.example/api/posts/post-1/insights');
  assert.equal(fetchSpy.calls[0].init.method, 'GET');
  assert.equal(fetchSpy.calls[0].init.headers.Authorization, `Bearer ${fakeKey}`);
});

test('secret resolver receives the op reference at call time', async () => {
  const fetchSpy = makeFetchSpy();
  const secretSpy = makeSecretSpy();
  const client = makeClient({ fetchImpl: fetchSpy.fetchImpl, secretImpl: secretSpy.secretImpl });

  assert.deepEqual(secretSpy.calls, []);

  await client.listAccounts();

  assert.deepEqual(secretSpy.calls, [apiKeyRef]);
});

