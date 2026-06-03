import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CrossPostFirewallError,
  assertSameStack,
} from '../lib/cross-post-firewall.mjs';

const configFixture = `paths:
  state_root: \${HOME}/\${SKILL_DIR}/state/social-evolve
platform_registry:
  vocus:
    access_mode: owned
    posting_mechanism: vocus_publish_adapter_1click
    language_stack: zh
  devto:
    access_mode: owned
    posting_mechanism: devto_canonical_spoke
    language_stack: en
`;

async function withConfig(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-firewall-'));
  const configPath = path.join(home, 'config.yaml');
  const env = { HOME: home, SKILL_DIR: '.claude', SOCIAL_POST_CONFIG_PATH: configPath };
  await writeFile(configPath, configFixture, 'utf8');
  try {
    return await fn({ env, configPath });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test('T11 zh edition routed to en surface throws', async () => {
  await withConfig(({ env, configPath }) => {
    assert.throws(
      () => assertSameStack({ lang: 'zh' }, 'devto', { env, configPath }),
      (error) =>
        error instanceof CrossPostFirewallError &&
        error.edition_lang === 'zh' &&
        error.surface_lang === 'en',
    );
  });
});

test('T12 en edition routed to zh surface throws', async () => {
  await withConfig(({ env, configPath }) => {
    assert.throws(
      () => assertSameStack({ lang: 'en' }, 'vocus', { env, configPath }),
      CrossPostFirewallError,
    );
  });
});

test('T13 same language-stack surface passes', async () => {
  await withConfig(({ env, configPath }) => {
    assert.equal(assertSameStack({ lang: 'zh' }, 'vocus', { env, configPath }), true);
  });
});

test('T14 unknown or excluded surface fails closed', async () => {
  await withConfig(({ env, configPath }) => {
    assert.throws(() => assertSameStack({ lang: 'zh' }, 'unknown', { env, configPath }));
    assert.throws(() => assertSameStack({ lang: 'zh' }, '知乎', { env, configPath }));
  });
});
