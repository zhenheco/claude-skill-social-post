import assert from 'node:assert/strict';
import test from 'node:test';

import { ARCHETYPE_TEMPLATES, templateFor } from '../lib/voice-bootstrap/archetype-templates.mjs';

test('templateFor returns distinct zh-tw and en templates', () => {
  const zh = templateFor('news_hottake', 'zh-tw');
  const en = templateFor('news_hottake', 'en');

  assert.notEqual(zh, en);
  assert.equal(zh, ARCHETYPE_TEMPLATES.news_hottake['zh-tw']);
  assert.equal(en, ARCHETYPE_TEMPLATES.news_hottake.en);
});

test('templateFor throws for unknown archetype or language', () => {
  assert.throws(() => templateFor('unknown', 'zh-tw'), /unknown archetype/u);
  assert.throws(() => templateFor('news_hottake', 'fr'), /unknown language/u);
});
