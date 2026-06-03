import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { stateRoot } from '../paths.mjs';

export class CapExceededError extends Error {
  constructor(platform) {
    super(`draft cap exceeded for ${platform}`);
    this.name = 'CapExceededError';
    this.platform = platform;
  }
}

export function enforceCap(platform, { counts = {}, caps = {} } = {}) {
  const cap = caps[platform] ?? Infinity;
  if ((counts[platform] ?? 0) >= cap) throw new CapExceededError(platform);
  return true;
}

export async function draft({ target, voice = {}, env = process.env, now = () => new Date().toISOString(), counts, caps } = {}) {
  if (!target?.platform) throw new Error('target.platform is required');
  const text = String(target.text ?? '').trim();
  if (qualityGate(text).skip) return { skip: true, reason: 'low-substance' };
  enforceCap(target.platform, { counts, caps });

  const flags = classifyTarget(target);
  const row = {
    kind: 'draft',
    send: false,
    text: renderReply(text, voice),
    platform: target.platform,
    flags,
    draft_id: `reply-${target.platform}-${Math.abs(hash(text))}`,
    ts: now(),
  };
  await appendDraftRow(row, env);
  return row;
}

export function qualityGate(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  return words.length < 5 ? { skip: true, reason: 'low-substance' } : { skip: false };
}

export function classifyTarget(target) {
  const reasons = [];
  const text = String(target?.text ?? '');
  if (target?.dispute || /dispute/i.test(text)) reasons.push('dispute');
  if (target?.client || /client/i.test(text)) reasons.push('client');
  if (target?.competitor || /competitor/i.test(text)) reasons.push('competitor');
  if (target?.high_reach || /high reach/i.test(text)) reasons.push('high_reach');
  return reasons.length > 0 ? { human_review_required: true, reason: reasons.join(',') } : { human_review_required: false };
}

function renderReply(text, voice) {
  const suffix = voice.cta_style ? ` (${voice.cta_style})` : '';
  return `Useful angle: ${text}${suffix}`;
}

async function appendDraftRow(row, env) {
  const file = path.join(env.SOCIAL_EVOLVE_STATE_ROOT ?? stateRoot(env), row.platform, 'engagement-drafts.jsonl');
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(row)}\n`, 'utf8');
}

function hash(text) {
  let value = 0;
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) | 0;
  return value;
}
