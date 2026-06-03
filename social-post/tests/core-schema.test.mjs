import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as core from '../lib/core-schema.mjs';

const sourceGuard = new RegExp('/(' + ['Users', 'home'].join('|') + ')/');

const validYaml = `name: "Nelson Chou"
niche: "enterprise AI adoption"
values: ["practical", "verifiable"]
avoid_topics: ["politics"]
objective_hierarchy:
  - tier: apex
    metrics: [line_utm_joins, paid_or_consult_submits]
  - tier: proxy
    metrics: [save_rate]
automation_policy:
  auto_send: false
  browser_posting: false
  trust_graduation: false
  mode: propose_only
write_bans:
  - user_custom
  - core.yaml
`;

async function withCoreFile(content, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'social-core-'));
  const file = path.join(dir, 'core.yaml');
  await writeFile(file, content, 'utf8');
  try {
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function without(linePattern) {
  return validYaml
    .split('\n')
    .filter((line) => !linePattern.test(line))
    .join('\n');
}

test('T1 valid full core yaml validates cleanly', async () => {
  await withCoreFile(validYaml, async (file) => {
    assert.deepEqual(await core.validate(file), { valid: true, errors: [] });
  });
});

test('T2 missing objective_hierarchy is rejected with key name', async () => {
  await withCoreFile(validYaml.replace(/objective_hierarchy:[\s\S]*?automation_policy:/, 'automation_policy:'), async (file) => {
    const result = await core.validate(file);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /objective_hierarchy/);
  });
});

test('T3 apex tier must contain both conversion tokens', async () => {
  await withCoreFile(validYaml.replace('line_utm_joins, paid_or_consult_submits', 'line_utm_joins'), async (file) => {
    const result = await core.validate(file);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /apex.*line_utm_joins.*paid_or_consult_submits/);
  });
});

for (const flag of ['auto_send', 'browser_posting', 'trust_graduation']) {
  test(`automation_policy.${flag}: true is rejected`, async () => {
    await withCoreFile(validYaml.replace(`${flag}: false`, `${flag}: true`), async (file) => {
      const result = await core.validate(file);
      assert.equal(result.valid, false);
      assert.match(result.errors.join('\n'), new RegExp(flag));
    });
  });
}

test('T7 automation_policy must explicitly encode all propose-only flags', async () => {
  await withCoreFile(without(/auto_send:|browser_posting:|trust_graduation:/), async (file) => {
    const result = await core.validate(file);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /auto_send/);
    assert.match(result.errors.join('\n'), /browser_posting/);
    assert.match(result.errors.join('\n'), /trust_graduation/);
  });
});

test('T8 write_bans must include user_custom', async () => {
  await withCoreFile(without(/user_custom/), async (file) => {
    const result = await core.validate(file);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /user_custom/);
  });
});

test('T9 write_bans must include core.yaml self-ban', async () => {
  await withCoreFile(without(/core\.yaml/), async (file) => {
    const result = await core.validate(file);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /core\.yaml/);
  });
});

test('T10 avoid_topics must be a non-empty list', async () => {
  await withCoreFile(validYaml.replace('avoid_topics: ["politics"]', 'avoid_topics: []'), async (file) => {
    const result = await core.validate(file);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /avoid_topics/);
  });
});

test('T11 validator collects multiple friendly errors', async () => {
  await withCoreFile(without(/auto_send:|user_custom/), async (file) => {
    const result = await core.validate(file);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 2);
    assert.ok(result.errors.every((message) => message.includes(': ')));
  });
});

test('T12 apex returns the locked two-token apex list', async () => {
  await withCoreFile(validYaml, async (file) => {
    assert.deepEqual(await core.apex(file), ['line_utm_joins', 'paid_or_consult_submits']);
  });
});

test('T13 writeBans returns the self-protection list', async () => {
  await withCoreFile(validYaml, async (file) => {
    assert.ok((await core.writeBans(file)).includes('user_custom'));
    assert.ok((await core.write_bans(file)).includes('core.yaml'));
  });
});

test('T14 loader exposes read-only frozen values only', async () => {
  await withCoreFile(validYaml, async (file) => {
    const loaded = await core.loadCore(file);
    assert.equal(typeof loaded.set, 'undefined');
    assert.equal(typeof loaded.update, 'undefined');
    const first = loaded.apex();
    assert.equal(Object.isFrozen(first), true);
    assert.throws(() => first.push('likes'), TypeError);
    assert.deepEqual(loaded.apex(), ['line_utm_joins', 'paid_or_consult_submits']);
  });
});

test('T15 env path is honored and source has no forbidden home literal', async () => {
  await withCoreFile(validYaml, async (file) => {
    const previous = process.env.SOCIAL_CORE_PATH;
    process.env.SOCIAL_CORE_PATH = file;
    try {
      assert.deepEqual(await core.apex(), ['line_utm_joins', 'paid_or_consult_submits']);
    } finally {
      if (previous == null) delete process.env.SOCIAL_CORE_PATH;
      else process.env.SOCIAL_CORE_PATH = previous;
    }
  });
  const source = await readFile(new URL('../lib/core-schema.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, sourceGuard);
});

test('T16 raw secret-shaped keys are rejected unless they use op references', async () => {
  await withCoreFile(`${validYaml}api_token: "literal-secret"\n`, async (file) => {
    const result = await core.validate(file);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /api_token/);
  });
  await withCoreFile(`${validYaml}api_token: "op://Dev/social/token"\n`, async (file) => {
    assert.equal((await core.validate(file)).valid, true);
  });
});

test('T17 shipped schemas/core.yaml validates cleanly', async () => {
  const file = new URL('../schemas/core.yaml', import.meta.url);
  assert.deepEqual(await core.validate(file), { valid: true, errors: [] });
});
