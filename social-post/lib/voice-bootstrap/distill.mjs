import { templateFor } from './archetype-templates.mjs';
import { assertAbstracted } from './originality-guard.mjs';

const URL_RE = /\bhttps?:\/\/\S+/giu;
const HANDLE_RE = /@[A-Za-z0-9_.-]+/gu;
const NUMBER_RE = /\b\d[\d,]*(?:\.\d+)?\b/gu;
const ENTITY_RE = /\b(?:[A-Z][A-Za-z0-9]*)(?:\s+[A-Z][A-Za-z0-9]*)*\b/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const PLACEHOLDER = '{placeholder}';
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/u;

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function reset(patterns) {
  for (const pattern of patterns) pattern.lastIndex = 0;
}

export function classifyHook(text) {
  const value = String(text ?? '');
  const lower = value.toLowerCase();
  const vulnerability = [/但真相是/u, /老實說/u, /結果/u, /\bthe truth is\b/u, /\bturns out\b/u, /\bhonestly\b/u, /\bi failed\b/u];
  const contrast = [/不是.+是/u, /其實不是/u, /底層邏輯/u, /\bnot\b.+\bit(?:'s| is)\b/u, /\bit is not\b.+\bit is\b/u];
  const news = [
    /(出了|推出|更新|上線|改版|發布)/u,
    /\b(dropped|just dropped|launched|released|shipped|unveiled|introduced)\b/u,
  ];
  const milestone = [
    /\d[\d,]*(?:\.\d+)?.*(里程碑|粉絲|突破|followers|subscribers)/u,
    /(突破|crossed|hit|reached).*\d[\d,]*(?:\.\d+)?/u,
    /\b(crossed|hit|reached)\b.+\b(followers|subscribers|milestone)\b/u,
  ];
  const practicalList = [
    /(清單|工具|流程|指南|模板|步驟|每天用)/u,
    /\b(people think|tools i use|free guides|here are|templates|prompts|workflows|steps|use daily)\b/u,
  ];
  const cautionary = [
    /(小心|警訊|如果你|不要只|風險|落後)/u,
    /\b(if you|beware|trap|falling behind|hidden risk|outsourcing risk|do not understand)\b/u,
  ];
  const founderStory = [
    /(我離職|開始創業|創業|接案|現實打臉|沒有客戶)/u,
    /\b(i quit|quit my job|started|start an? .*(agency|startup|company|project)|reality hit|no clients|no case studies)\b/u,
  ];

  reset([...vulnerability, ...contrast, ...news, ...milestone, ...practicalList, ...cautionary, ...founderStory]);
  if (hasAny(lower, vulnerability)) return 'vulnerability_reveal';
  if (hasAny(lower, contrast)) return 'principle_contrast';
  if (hasAny(lower, news)) return 'news_hottake';
  if (hasAny(lower, milestone)) return 'milestone_mission';
  if (hasAny(lower, founderStory)) return 'founder_story';
  if (hasAny(lower, cautionary)) return 'cautionary_take';
  if (hasAny(lower, practicalList)) return 'practical_list';
  return 'other';
}

function collapsePlaceholders(text) {
  return text
    .replace(new RegExp(`(?:${PLACEHOLDER.replace(/[{}]/g, '\\$&')}\\s*){2,}`, 'gu'), `${PLACEHOLDER} `)
    .replace(/\s+/gu, ' ')
    .trim();
}

export function skeletonize(text) {
  return collapsePlaceholders(
    String(text ?? '')
      .replace(URL_RE, PLACEHOLDER)
      .replace(HANDLE_RE, PLACEHOLDER)
      .replace(NUMBER_RE, PLACEHOLDER)
      .replace(ENTITY_RE, PLACEHOLDER),
  );
}

function sentenceUnits(text) {
  const cjkChars = Array.from(String(text ?? '').matchAll(/[\u3400-\u9fff\uf900-\ufaff]/gu)).length;
  if (cjkChars > 0) return cjkChars;
  return String(text ?? '').split(/\s+/u).filter(Boolean).length;
}

function bucket(avg) {
  if (avg < 8) return 'short';
  if (avg <= 24) return 'medium';
  return 'long';
}

function beatCount(text) {
  return Math.max(1, String(text ?? '').split(/[。！？!?]\s*|\.\s+|:\s+|\n+/u).filter((part) => part.trim()).length);
}

function registerHint(posts) {
  const text = posts.map((post) => post.text ?? post).join('\n').toLowerCase();
  if (/(老實說|我|honestly|\bi\b|\bmy\b|\bwe\b)/u.test(text)) return 'personal';
  if (/(roi|system|framework|conversion|metric|workflow)/u.test(text)) return 'operator';
  return 'neutral';
}

export function styleFingerprint(posts = []) {
  const rows = posts.map((post) => ({ text: String(post.text ?? post ?? '') }));
  if (rows.length === 0) {
    return Object.freeze({
      sentence_length_bucket: 'short',
      emoji_density: 0,
      avg_beats: 0,
      link_rate: 0,
      register_hint: 'neutral',
    });
  }
  const avgLength = rows.reduce((sum, post) => sum + sentenceUnits(post.text), 0) / rows.length;
  const emojiPosts = rows.filter((post) => EMOJI_RE.test(post.text)).length;
  EMOJI_RE.lastIndex = 0;
  const linkPosts = rows.filter((post) => URL_RE.test(post.text)).length;
  URL_RE.lastIndex = 0;
  const avgBeats = rows.reduce((sum, post) => sum + beatCount(post.text), 0) / rows.length;
  return Object.freeze({
    sentence_length_bucket: bucket(avgLength),
    emoji_density: Number((emojiPosts / rows.length).toFixed(3)),
    avg_beats: Number(avgBeats.toFixed(3)),
    link_rate: Number((linkPosts / rows.length).toFixed(3)),
    register_hint: registerHint(rows),
  });
}

function engagementScore(post) {
  const engagement = post.engagement ?? {};
  return ['likes', 'comments', 'reposts', 'shares'].reduce((sum, key) => sum + Number(engagement[key] ?? 0), 0);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function languageOf(text) {
  return CJK_RE.test(String(text ?? '')) ? 'zh-tw' : 'en';
}

export function distill(posts = [], { minEngagementPct = 0 } = {}) {
  const rows = [...posts];
  const maxEngagement = rows.reduce((max, post) => Math.max(max, engagementScore(post)), 0);
  const floor = maxEngagement * Number(minEngagementPct ?? 0);
  const selected = rows.filter((post) => engagementScore(post) >= floor);
  const byArchetypeLang = new Map();
  let otherCount = 0;

  for (const post of selected) {
    const pattern = classifyHook(post.text);
    if (pattern === 'other') {
      otherCount += 1;
      continue;
    }
    const lang = languageOf(post.text);
    const skeleton = templateFor(pattern, lang);
    const key = `${pattern}\n${lang}`;
    const current = byArchetypeLang.get(key) ?? { pattern, skeleton, count: 0, source_ids: [] };
    current.count += 1;
    current.source_ids.push(String(post.source_id));
    byArchetypeLang.set(key, current);
  }

  const rawTexts = selected.map((post) => String(post.text ?? ''));
  const patterns = [...byArchetypeLang.values()].map((pattern) => {
    assertAbstracted(pattern.skeleton, rawTexts);
    const sourceIds = uniqueSorted(pattern.source_ids);
    return Object.freeze({
      pattern: pattern.pattern,
      count: pattern.count,
      skeleton: pattern.skeleton,
      source_ids: Object.freeze(sourceIds),
      single_source: sourceIds.length < 2,
    });
  }).sort((left, right) =>
    right.count - left.count
    || left.pattern.localeCompare(right.pattern)
    || left.skeleton.localeCompare(right.skeleton));

  return Object.freeze({
    patterns: Object.freeze(patterns),
    style_fingerprint: styleFingerprint(selected),
    sample_count: selected.length,
    other_count: otherCount,
  });
}
