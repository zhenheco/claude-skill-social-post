import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolve } from './paths.mjs';
import { upsert as upsertSource } from './sources.mjs';
import { dump, parse } from './yaml.mjs';

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL = /https?:\/\/\S+|www\.\S+/gi;
const HANDLE = /@[A-Za-z0-9_.-]+/g;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const DOMAIN = /\b[A-Za-z0-9-]+\.(?:com|co|io|ai|net|org|tw|app|dev|xyz)(?:\b|\/\S*)/gi;
const ID_LIKE = /\b[A-Za-z]+-[A-Za-z0-9]{10,}\b/g;
const VERSION = /\bv\d+(?:\.\d+)*\b/gi;
const NUMBER = /\b\d+(?:[.,]\d+)?\b/g;
const EN_NAME = /\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g;
const ZH_NAME = /[\u4e00-\u9fff]{2,4}(?:先生|小姐|老師|醫師|博士|總監|經理)/g;

function normalizedText(text) {
  return String(text ?? '').normalize('NFKC');
}

function hasResidualPII(text) {
  return [EMAIL, URL, HANDLE, PHONE, DOMAIN, ID_LIKE, EN_NAME, ZH_NAME].some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export function scrubPII(text) {
  const original = normalizedText(text);
  ID_LIKE.lastIndex = 0;
  if (ID_LIKE.test(original)) throw new Error('residual PII-like token detected');
  const scrubbed = original
    .replace(EMAIL, ' ')
    .replace(URL, ' ')
    .replace(HANDLE, ' ')
    .replace(PHONE, ' ')
    .replace(DOMAIN, ' ')
    .replace(EN_NAME, ' ')
    .replace(ZH_NAME, ' ')
    .replace(VERSION, ' ')
    .replace(NUMBER, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (hasResidualPII(scrubbed)) throw new Error('residual PII detected after scrub');
  return scrubbed;
}

export function toArchetype(text) {
  const lower = normalizedText(text).toLowerCase();
  const tokens = [];

  if (/\b(shipped|launched|proved|proof|case|result|結果|證明|實測)\b/i.test(lower)) tokens.push('proof-open');
  else if (/\b(mistake|wrong|myth|contrarian|反常識|錯誤)\b/i.test(lower)) tokens.push('contrarian-open');
  else tokens.push('insight-open');

  if (/\d+\s*(lessons?|ways?|steps?|rules?)|lessons?:|清單|步驟|重點/i.test(text)) tokens.push('numbered-listicle');
  else if (/\b(before|after|teardown|breakdown|拆解)\b/i.test(lower)) tokens.push('teardown-format');
  else tokens.push('compact-takeaway');

  if (/\b(i|we|my|our|first-person|client|customer)\b/i.test(lower)) tokens.push('first-person-proof');
  else tokens.push('aggregate-pattern');

  return tokens.join(' + ');
}

export function distill(rawRecord = {}, options = {}) {
  const scrubbed = scrubPII(rawRecord.raw_text);
  const abstractedTemplate = toArchetype(rawRecord.raw_text);
  if (hasResidualPII(abstractedTemplate)) throw new Error('residual PII detected in abstracted template');

  return Object.freeze({
    abstracted_template: abstractedTemplate,
    source_id: rawRecord.source_id,
    originality_inputs: Object.freeze({
      pattern_origin: 'external',
      internal_winner_required: true,
    }),
    distilled_at: (options.now ?? new Date()).toISOString(),
    source_text_length: scrubbed.length,
  });
}

async function readYaml(file, fallback) {
  try {
    return parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
}

async function atomicWriteYaml(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await writeFile(tmp, dump(value), 'utf8');
  await rename(tmp, file);
}

export async function distillRaw(rawRecord, { platform, env = process.env, configPath, now = new Date() } = {}) {
  const distilled = distill(rawRecord, { now });
  const inspirationDir = resolve('inspiration', platform, env, configPath).path;
  const file = path.join(inspirationDir, `${platform}.yaml`);
  const current = await readYaml(file, { abstracted_templates: [] });
  const existing = Array.isArray(current.abstracted_templates) ? current.abstracted_templates : [];
  const entry = Object.freeze({
    source_id: distilled.source_id,
    abstracted_template: distilled.abstracted_template,
    distilled_at: distilled.distilled_at,
    ttl_expires_at: rawRecord.ttl_expires_at,
    pattern_origin: distilled.originality_inputs.pattern_origin,
    internal_winner_required: distilled.originality_inputs.internal_winner_required,
    candidate_status: 'needs_internal_r6_winner',
    score: 0.5,
  });
  const exists = existing.some((item) => item.abstracted_template === entry.abstracted_template);
  const next = { ...current, abstracted_templates: exists ? existing : [...existing, entry] };
  const serialized = dump(next);

  if (rawRecord?.raw_text && serialized.includes(rawRecord.raw_text)) {
    throw new Error('raw text leaked into distilled inspiration');
  }

  await upsertSource(
    {
      source_id: rawRecord.source_id,
      trust: 0.5,
      influence_cap: 0.25,
      access_mode: rawRecord.access_mode,
      drift_flag: false,
    },
    { platform, env, configPath },
  );
  await atomicWriteYaml(file, next);
  return entry;
}
