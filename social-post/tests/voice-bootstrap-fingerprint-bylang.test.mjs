import assert from 'node:assert/strict';
import test from 'node:test';

import {
  distill,
  styleFingerprintByLang,
} from '../lib/voice-bootstrap/distill.mjs';

function post(text, sourceId = text.slice(0, 12)) {
  return {
    source_id: sourceId,
    text,
    engagement: { likes: 1, comments: 0, reposts: 0, shares: 0 },
    captured_at: '2026-06-04T00:00:00.000Z',
  };
}

test('styleFingerprintByLang keeps short zh posts from being inflated by long English posts', () => {
  const fingerprints = styleFingerprintByLang([
    post('今天先修一個小流程。', 'zh-a'),
    post('把驗收標準寫清楚，團隊就少一次來回。', 'zh-b'),
    post('I spent the morning mapping every handoff in the publishing workflow, then I removed the steps that made review slower than drafting itself because the team needed a clearer operating rhythm.', 'en-a'),
    post('The useful lesson was not to add another automation layer, but to keep the human approval checkpoint visible before anything reaches production, especially when multiple people edit the same draft.', 'en-b'),
    post('When a content system mixes research notes, drafts, edits, and publishing state, the real risk is losing context between each operator handoff before the final review and scheduled publication.', 'en-c'),
  ]);

  assert.deepEqual(Object.keys(fingerprints).sort(), ['en', 'zh-tw']);
  assert.equal(
    fingerprints['zh-tw'].sentence_length_bucket,
    'short',
    'zh-tw sentence length must be computed only from zh-tw posts, not inflated by long English posts',
  );
  assert.equal(
    fingerprints.en.sentence_length_bucket,
    'long',
    'English sentence length should still be computed from the English segment only',
  );
});

test('distill exposes one zh-tw segment for a zh-only corpus and keeps top-level style equal to it', () => {
  const result = distill([
    post('今天把內容流程重新整理了一輪。先記錄問題，再修正最小步驟。', 'zh-a'),
    post('老實說這次更新不大，但它讓團隊少掉兩次手動交接。', 'zh-b'),
  ]);

  assert.deepEqual(
    Object.keys(result.style_fingerprint_by_lang),
    ['zh-tw'],
    'a single-language zh-tw corpus should only emit the zh-tw language segment',
  );
  assert.deepEqual(
    result.style_fingerprint,
    result.style_fingerprint_by_lang['zh-tw'],
    'backward-compatible top-level fingerprint should equal the dominant/primary language segment',
  );
});
