import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyHook,
  distill,
  skeletonize,
  styleFingerprint,
} from '../lib/voice-bootstrap/distill.mjs';
import {
  OriginalityError,
  assertAbstracted,
} from '../lib/voice-bootstrap/originality-guard.mjs';
import { templateFor } from '../lib/voice-bootstrap/archetype-templates.mjs';

function post(overrides = {}) {
  return {
    source_id: 'src-a',
    text: 'default text',
    engagement: { likes: 0, comments: 0, reposts: 0, shares: 0 },
    captured_at: '2026-06-04T00:00:00.000Z',
    ...overrides,
  };
}

test('classifyHook detects zh and en hook archetypes', () => {
  assert.equal(classifyHook('OpenAI 發布新功能，但我覺得真正影響的是中小企業工作流'), 'news_hottake');
  assert.equal(classifyHook('老實說，我第一次做顧問案時完全搞砸，結果學到一件事'), 'vulnerability_reveal');
  assert.equal(classifyHook('不是更多流量，是更清楚的轉換路徑，這才是底層邏輯'), 'principle_contrast');
  assert.equal(classifyHook('突破 10,000 followers，這是一個新的里程碑'), 'milestone_mission');
  assert.equal(classifyHook('Notion launched a small update, but the real win is team memory'), 'news_hottake');
  assert.equal(classifyHook('Honestly, I failed the first launch. Turns out the checklist was the product.'), 'vulnerability_reveal');
  assert.equal(classifyHook('It is not more hacks, it is a sharper operating principle.'), 'principle_contrast');
  assert.equal(classifyHook('We crossed 5000 followers and this milestone changes the mission.'), 'milestone_mission');
  assert.equal(classifyHook('People think learning AI takes months. I wrote 17 free guides that teach it in hours.'), 'practical_list');
  assert.equal(classifyHook('If you are using AI but do not understand these terms, you are falling behind.'), 'cautionary_take');
  assert.equal(classifyHook('I quit my job to start an AI automation agency. Three weeks in, reality hit.'), 'founder_story');
  assert.equal(classifyHook('A quiet note without any strong opening signal'), 'other');
});

test('classifyHook detects observed English contrast and cautionary LinkedIn hooks', () => {
  assert.equal(classifyHook('Most AI agencies are selling automation backwards.'), 'principle_contrast');
  assert.equal(classifyHook('The most successful people I know are working less, not more.'), 'principle_contrast');
  assert.equal(classifyHook("You don't need 100K followers. You only need 100 customers."), 'principle_contrast');
  assert.equal(classifyHook('Are your AI agents solving problems, or just running broken processes faster?'), 'cautionary_take');
  assert.equal(classifyHook('I stopped letting AI news run my life. It was costing me more than I realized.'), 'cautionary_take');
});

test('classifyHook detects launch verbs, truth reveals, and zh contrast fixtures', () => {
  assert.equal(classifyHook('Claude Code 出了 hooks，我今天才發現它改掉整個工作流'), 'news_hottake');
  assert.equal(classifyHook('這次看起來很順，但真相是：我前一天把整個流程重做三次'), 'vulnerability_reveal');
  assert.equal(classifyHook('AI 產品的底層邏輯不是 找更多模型 是 把上下文變成資產'), 'principle_contrast');
});

test('skeletonize strips URLs, handles, entities, and numbers', () => {
  const skeleton = skeletonize('OpenAI 與 AICycle 在 Taipei 幫 @acejou 交付 42 個案子 https://example.com/x');

  assert.equal(skeleton, '{placeholder} 與 {placeholder} 在 {placeholder} 幫 {placeholder} 交付 {placeholder} 個案子 {placeholder}');
});

test('styleFingerprint summarizes sentence length, emoji density, beats, links, and register', () => {
  const fp = styleFingerprint([
    post({ text: 'I shipped the first version. Here is the lesson: keep the loop tiny 🙂 https://example.com' }),
    post({ text: '老實說今天卡住了，但最後找到更穩的節奏。' }),
  ]);

  assert.deepEqual(fp, {
    // CJK-dominant mixed fixtures now use char-calibrated thresholds instead of legacy word thresholds.
    sentence_length_bucket: 'short',
    emoji_density: 0.5,
    avg_beats: 2,
    link_rate: 0.5,
    register_hint: 'personal',
  });
});

test('styleFingerprint uses CJK length thresholds for short zh Threads posts', () => {
  const fp = styleFingerprint([
    post({ text: '今天把內容流程重新整理了一輪。先記錄問題，再修正最小步驟，最後才交付。' }),
    post({ text: '這次更新看起來不大，但它讓團隊少掉兩次手動交接，節奏也更穩。' }),
    post({ text: '我會先看驗收標準，再決定要不要自動化，否則只是把混亂跑得更快。' }),
  ]);

  assert.notEqual(fp.sentence_length_bucket, 'long');
});

test('styleFingerprint keeps latin word-count buckets unchanged', () => {
  const fp = styleFingerprint([
    post({ text: 'I shipped a small fix today.' }),
    post({ text: 'The review loop is finally tighter.' }),
  ]);

  assert.equal(fp.sentence_length_bucket, 'short');
});

test('distill applies relative engagement floor, dedupes skeletons, and marks single-source patterns', () => {
  const result = distill([
    post({
      source_id: 'src-a',
      text: '老實說 Acme 今天突破 1000 followers，結果學到一件事',
      engagement: { likes: 100, comments: 20, reposts: 5, shares: 5 },
    }),
    post({
      source_id: 'src-b',
      text: '老實說 Beta 今天突破 2000 followers，結果學到一件事',
      engagement: { likes: 90, comments: 20, reposts: 5, shares: 5 },
    }),
    post({
      source_id: 'src-c',
      text: 'Notion launched a tiny update, but my opinion is that teams need less tooling.',
      engagement: { likes: 1, comments: 0, reposts: 0, shares: 0 },
    }),
  ], { minEngagementPct: 0.5 });

  assert.equal(result.sample_count, 2);
  assert.equal(result.patterns.length, 1);
  assert.equal(result.patterns[0].pattern, 'vulnerability_reveal');
  assert.equal(result.patterns[0].count, 2);
  assert.deepEqual(result.patterns[0].source_ids, ['src-a', 'src-b']);
  assert.equal(result.patterns[0].single_source, false);

  const single = distill([
    post({
      source_id: 'src-a',
      text: '不是 Acme 的流量，是 100 個 Line 諮詢，這才是底層邏輯',
      engagement: { likes: 10, comments: 0, reposts: 0, shares: 0 },
    }),
  ], { minEngagementPct: 0 });
  assert.equal(single.patterns[0].single_source, true);
});

test('distill emits abstract archetype templates for realistic zh and en corpus', () => {
  const corpus = [
    post({ source_id: 'zh-news-1', text: 'Claude Code 出了 background agents。真正影響會落在例行 debug 的委派流程，團隊節奏會完全不同。', engagement: { likes: 90 } }),
    post({ source_id: 'zh-news-2', text: 'Threads 推出新的長文介面，重點會落在創作者能不能把一段思考完整收束。', engagement: { likes: 80 } }),
    post({ source_id: 'zh-vuln-1', text: '這次 demo 看起來很順。但真相是：我前一天把 prompt 全部重寫，才發現問題不是模型，是驗收標準太鬆。', engagement: { likes: 70 } }),
    post({ source_id: 'zh-vuln-2', text: '大家看到的是我準時上線。但真相是：我連續三晚都卡在資料同步，最後學到先保護原始資料。', engagement: { likes: 60 } }),
    post({ source_id: 'zh-contrast-1', text: 'AI 團隊的底層邏輯不是 找更多工具 是 把決策、驗收、修正變成同一條鏈。', engagement: { likes: 50 } }),
    post({ source_id: 'zh-milestone-1', text: '突破 10000 追蹤，對我代表更多中小團隊開始相信自動化也能很務實。', engagement: { likes: 40 } }),
    post({ source_id: 'zh-other-1', text: '今天把所有筆記重新整理一次，提醒自己不要把忙碌誤認成進度。', engagement: { likes: 30 } }),
    post({ source_id: 'zh-other-2', text: '早上重新看了一遍使用者訪談，有些句子比任何 dashboard 都直接。', engagement: { likes: 20 } }),
    post({ source_id: 'en-news-1', text: 'Notion just shipped offline mode. The point is not convenience; it changes when teams can trust shared memory.', engagement: { likes: 95 } }),
    post({ source_id: 'en-news-2', text: 'OpenAI released a small workflow update today. For operators, the real impact is fewer handoffs between draft and review.', engagement: { likes: 85 } }),
    post({ source_id: 'en-vuln-1', text: 'The launch looked clean. But the truth is: I spent two days deleting clever automation that made the review loop weaker.', engagement: { likes: 75 } }),
    post({ source_id: 'en-contrast-1', text: "The real logic of creator systems is not posting more, it's building a repeatable taste and feedback loop.", engagement: { likes: 65 } }),
    post({ source_id: 'en-milestone-1', text: 'We crossed 5000 subscribers, and it is not vanity to me. It means the playbook is helping solo operators ship.', engagement: { likes: 55 } }),
    post({ source_id: 'en-list-1', text: 'People think learning AI takes months. It does not. Here are 7 workflows that teach it in hours.', engagement: { likes: 45 } }),
    post({ source_id: 'en-list-2', text: 'Tools I use daily that are worth it: Claude Code, Playwright, n8n, Whisper, and one reusable checklist.', engagement: { likes: 44 } }),
    post({ source_id: 'en-caution-1', text: 'If your team uses AI but cannot explain the failure mode, you are not automating work, you are outsourcing risk.', engagement: { likes: 43 } }),
    post({ source_id: 'en-founder-1', text: 'I quit my job to start an AI automation agency. Three weeks in, reality hit: no case studies, no clients, no proof.', engagement: { likes: 42 } }),
    post({ source_id: 'en-other-1', text: 'I spent the morning reading interview notes and marking the parts that still felt unclear.', engagement: { likes: 45 } }),
  ];
  const rawTexts = corpus.map((entry) => entry.text);

  const result = distill(corpus);

  assert.equal(result.sample_count, corpus.length);
  assert.equal(result.other_count, 3);
  assert.deepEqual(
    result.patterns.map((entry) => `${entry.pattern}:${entry.skeleton}`).sort(),
    [
      `milestone_mission:${templateFor('milestone_mission', 'en')}`,
      `milestone_mission:${templateFor('milestone_mission', 'zh-tw')}`,
      `news_hottake:${templateFor('news_hottake', 'en')}`,
      `news_hottake:${templateFor('news_hottake', 'zh-tw')}`,
      `practical_list:${templateFor('practical_list', 'en')}`,
      `principle_contrast:${templateFor('principle_contrast', 'en')}`,
      `principle_contrast:${templateFor('principle_contrast', 'zh-tw')}`,
      `cautionary_take:${templateFor('cautionary_take', 'en')}`,
      `founder_story:${templateFor('founder_story', 'en')}`,
      `vulnerability_reveal:${templateFor('vulnerability_reveal', 'en')}`,
      `vulnerability_reveal:${templateFor('vulnerability_reveal', 'zh-tw')}`,
    ].sort(),
  );
  assert.equal(result.patterns.find((entry) => entry.skeleton === templateFor('news_hottake', 'zh-tw')).count, 2);
  assert.equal(result.patterns.find((entry) => entry.skeleton === templateFor('news_hottake', 'en')).count, 2);
  assert.equal(result.patterns.some((entry) => entry.pattern === 'other'), false);
  for (const pattern of result.patterns) {
    assert.doesNotThrow(() => assertAbstracted(pattern.skeleton, rawTexts));
  }
});

test('assertAbstracted blocks verbatim overlap and passes abstracted skeletons', () => {
  assert.throws(
    () => assertAbstracted('alpha beta gamma delta epsilon zeta', ['alpha beta gamma delta epsilon zeta eta']),
    OriginalityError,
  );

  assert.doesNotThrow(() =>
    assertAbstracted('personal reveal then placeholder outcome then short lesson', [
      'OpenAI 發布 Canvas，讓團隊今天省下 42 小時',
    ]),
  );
});
