#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadVoiceContext, pickArchetypes } from '../lib/generate/voice-context.mjs';

function valueAfter(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1];
}

function parseArgs(argv) {
  const n = Number(valueAfter(argv, '--n') ?? 1);
  const recent = String(valueAfter(argv, '--recent') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return Object.freeze({
    platform: valueAfter(argv, '--platform'),
    topic: valueAfter(argv, '--topic'),
    recent,
    n: Number.isFinite(n) ? n : 1,
  });
}

function boolLine(label, value) {
  return `${label}:${value === true ? 'true' : 'false'}`;
}

function list(value) {
  return Array.isArray(value) && value.length ? value.join(', ') : 'none';
}

function isMaterial(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function materialLines(material) {
  return [
    '',
    '## Source Material（素材，非模板）',
    `Brand: ${material.brand} — 僅作觀點素材；輸出必須是第一人稱個人觀點（「我最近在想/我發現」），禁止業配腔、禁止逐字改寫文章。`,
    `Title: ${material.title}`,
    'Key excerpt:',
    material.excerpt ?? '',
    `URL policy: ${material.url ? `可在文末附 ${material.url}` : '本平台禁止外部連結（R25）— 只取洞見，不提連結'}`,
  ];
}

export function renderBrief(brief, chosen, topicOrMaterial) {
  const style = brief.style_fingerprint ?? {};
  const directive = brief.voice_directive ?? {};
  const lines = [
    `# Generation Brief: ${brief.platform}`,
    '',
    `Identity: ${brief.identity.name} — ${brief.identity.niche}`,
    `Values: ${list(brief.identity.values)}`,
    '',
    '## TONE DIRECTIVE',
    `- 更銳 sharpness:${directive.sharpness ?? 'unset'}`,
    `- 展現實力 ${boolLine('demonstrate_expertise', directive.demonstrate_expertise)}`,
    `- ${boolLine('proof_over_claim', directive.proof_over_claim)}`,
    '',
    `Target language: ${brief.language}`,
    `Format default: ${brief.format_default ?? 'unset'}`,
  ];

  if (typeof topicOrMaterial === 'string' && topicOrMaterial) lines.push(`Topic: ${topicOrMaterial}`);
  if (isMaterial(topicOrMaterial)) lines.push(...materialLines(topicOrMaterial));

  lines.push(
    '',
    '## Chosen Archetype Skeletons',
    ...chosen.map((entry) => `- ${entry.archetype}: ${entry.skeleton}`),
    '',
    '## Style Targets',
    `- sentence_length_bucket: ${style.sentence_length_bucket ?? 'unset'}`,
    `- avg_beats: ${style.avg_beats ?? 'unset'}`,
    `- emoji_density: ${style.emoji_density ?? 'unset'}`,
    `- link_rate: ${style.link_rate ?? 'unset'}`,
    `- register_hint: ${style.register_hint ?? 'unset'}`,
    '',
    `Apex CTA reminder: ${list(brief.apex_ctas)}`,
    `BANS: ${list([...brief.avoid_topics, ...brief.forbidden_imports])}`,
    '',
    'Output is a DRAFT only. Human posts every word. No auto-send (automation_policy.mode=propose_only).',
  );

  return `${lines.join('\n')}\n`;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (!args.platform) throw new Error('--platform is required');
  const brief = await loadVoiceContext(args.platform, { env });
  if (!brief.seeded) {
    process.stdout.write(`voice not seeded for ${brief.platform} — run voice-bootstrap first\n`);
    return 0;
  }
  process.stdout.write(renderBrief(brief, pickArchetypes(brief, { recent: args.recent, n: args.n }), args.topic));
  return 0;
}

if (process.argv[1] && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
