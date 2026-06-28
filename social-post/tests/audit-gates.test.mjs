import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('dashboard static renderer does not assign HTML strings', async () => {
  const source = await readFile(new URL('../dashboard/static/dashboard.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /\.innerHTML\s*=/);
});

test('repo root exposes reusable AFK quality gates', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const workflow = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

  assert.equal(packageJson.scripts.test, 'npm --prefix social-post test');
  assert.equal(packageJson.scripts.check, 'npm test');
  assert.match(workflow, /npm test/);
});

test('repo guidance documents standalone checkout boundary', async () => {
  const guidance = await readFile(new URL('../../AGENTS.md', import.meta.url), 'utf8');

  assert.match(guidance, /CC_CLI_HOME/);
  assert.match(guidance, /standalone/i);
});
