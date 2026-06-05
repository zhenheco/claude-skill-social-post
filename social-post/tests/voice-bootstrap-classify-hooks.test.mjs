import assert from 'node:assert/strict';
import test from 'node:test';

import { templateFor } from '../lib/voice-bootstrap/archetype-templates.mjs';
import { classifyHook } from '../lib/voice-bootstrap/distill.mjs';

const newArchetypes = ['old_new_contrast', 'tool_discovery', 'pov_question'];

test('classifyHook detects old/new contrast hooks', () => {
  assert.equal(
    classifyHook('Old way: hire a VA, buy three tools, glue them together. New way: drop this AI pipeline into Claude Code and ship.'),
    'old_new_contrast',
  );
  assert.equal(classifyHook('以前要花一週做的事，現在一個下午就搞定。'), 'old_new_contrast');
  assert.equal(classifyHook('過去每次都要手動整理素材，現在交給 AI pipeline 先跑一輪。'), 'old_new_contrast');
});

test('classifyHook detects tool discovery hooks', () => {
  assert.equal(
    classifyHook('I found a GitHub repo that builds your entire agent team from one sentence.'),
    'tool_discovery',
  );
  assert.equal(
    classifyHook('Someone created a skill for Claude that generates the perfect prompt for any AI.'),
    'tool_discovery',
  );
  assert.equal(classifyHook('我發現一個工具，可以把研究筆記變成完整發文流程。'), 'tool_discovery');
  assert.equal(classifyHook('有人做了一個 skill，可以直接產生 Claude 工作流。'), 'tool_discovery');
});

test('classifyHook detects POV question hooks', () => {
  assert.equal(classifyHook('POV: which one would YOU recommend?'), 'pov_question');
  assert.equal(classifyHook('Real question: which ONE are you actually using?'), 'pov_question');
  assert.equal(classifyHook('你會選哪一個？'), 'pov_question');
  assert.equal(classifyHook('說真的，你現在用哪個？'), 'pov_question');
});

test('classifyHook classifies benchmark posts that previously dropped as other', () => {
  assert.equal(
    classifyHook('Old way: hire a VA, buy three outbound tools, glue them together. New way: drop this AI cold outreach pipeline into Claude Code and start vibe prospecting.'),
    'old_new_contrast',
  );
  assert.equal(
    classifyHook('I found a GitHub repo that builds your entire Claude Code agent team from one sentence. Not a template. A skill that writes other skills.'),
    'tool_discovery',
  );
  assert.equal(
    classifyHook('POV: which one would YOU recommend? Real question: which ONE are you actually using?'),
    'pov_question',
  );
});

test('new hook archetypes have non-empty zh-tw and en templates', () => {
  for (const archetype of newArchetypes) {
    assert.match(templateFor(archetype, 'zh-tw'), /\S/u);
    assert.match(templateFor(archetype, 'en'), /\S/u);
  }
});
