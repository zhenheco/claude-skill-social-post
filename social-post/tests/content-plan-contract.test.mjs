import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function readSkillFile(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('content plan docs define the platform-aware tracking contract', async () => {
  const [phase0, example] = await Promise.all([
    readSkillFile('references/phase0_plan.md'),
    readSkillFile('content_plan.example.md'),
  ]);

  const required = [
    '## 平台記錄',
    '## 本輪日曆',
    '## 20 篇冷啟動假設',
    '## 戰績記錄（總表）',
    '## Facebook 記錄',
    '## LinkedIn 記錄',
    '72 小時',
    'human_sample_count: 0',
    'Chrome on demand',
  ];

  for (const text of required) {
    assert.match(example, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(phase0, /平台記錄/);
  assert.match(phase0, /平台各自記錄/);
  assert.match(phase0, /20 篇冷啟動/);
});
