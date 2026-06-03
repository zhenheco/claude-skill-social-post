import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolve } from './paths.mjs';
import { dump } from './yaml.mjs';

export const PLATFORMS = Object.freeze(['facebook', 'instagram', 'threads', 'x', 'linkedin']);
export const R1_R32 = Object.freeze(Array.from({ length: 32 }, (_, index) => `R${index + 1}`));

const EXCLUDED = Object.freeze(['小紅書', '即刻', '知乎']);
const REQUIRED_FIELDS = Object.freeze([
  'primary_language',
  'format_default',
  'primary_success_metric',
  'cadence_ceiling',
  'forbidden_imports',
  'hook_style',
  'cta_style',
  'few_shot',
  'voice_state',
  'version',
  'changelog',
  'applied_proposal_id',
]);

const DEFAULTS = Object.freeze({
  facebook: ['zh-tw', 'community-post', 'private_share'],
  instagram: ['zh-tw', 'caption', 'save_rate'],
  threads: ['zh-tw', 'short-thread', 'reply_rate'],
  x: ['en', 'long-form', 'profile_visits'],
  linkedin: ['en', 'professional-post', 'consult_form_submits'],
});

export function isValidSemver(value) {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
}

function pushError(errors, code, path, message) {
  errors.push(Object.freeze({ code, path, message }));
}

function validateRequired(obj, errors) {
  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(obj ?? {}, field)) pushError(errors, `${field}_required`, field, `${field} is required`);
  }
}

function validateFewShot(fewShot, errors) {
  if (!Array.isArray(fewShot)) {
    pushError(errors, 'few_shot_not_list', 'few_shot', 'few_shot must be a list');
    return;
  }
  fewShot.forEach((entry, index) => {
    if (!['human', 'machine'].includes(entry?.origin)) {
      pushError(errors, 'few_shot_origin_invalid', `few_shot[${index}].origin`, 'origin must be human or machine');
    }
  });
}

function validateForbiddenImports(obj, platform, errors) {
  if (!Array.isArray(obj?.forbidden_imports)) {
    pushError(errors, 'forbidden_imports_not_list', 'forbidden_imports', 'forbidden_imports must be a list');
    return;
  }
  if (platform === 'linkedin') {
    const missing = R1_R32.filter((rule) => !obj.forbidden_imports.includes(rule));
    if (missing.length) {
      pushError(errors, 'linkedin_must_forbid_R1_R32', 'forbidden_imports', `missing ${missing.join(',')}`);
    }
  }
}

function validateVoiceState(voiceState, errors) {
  if (!voiceState || typeof voiceState !== 'object') {
    pushError(errors, 'voice_state_invalid', 'voice_state', 'voice_state must be an object');
    return;
  }
  if (!Number.isInteger(voiceState.human_sample_count) || voiceState.human_sample_count < 0) {
    pushError(errors, 'voice_state_human_sample_count_invalid', 'voice_state.human_sample_count', 'must be a non-negative integer');
  }
  if (!(typeof voiceState.last_reanchor === 'string' || voiceState.last_reanchor === null)) {
    pushError(errors, 'voice_state_last_reanchor_invalid', 'voice_state.last_reanchor', 'must be a string or null');
  }
}

export function validateVoiceFile(obj, { platform } = {}) {
  const errors = [];
  validateRequired(obj, errors);
  if (!isValidSemver(obj?.version)) pushError(errors, 'version_invalid_semver', 'version', 'version must be x.y.z');
  validateFewShot(obj?.few_shot, errors);
  validateForbiddenImports(obj, platform, errors);
  validateVoiceState(obj?.voice_state, errors);
  if (!Array.isArray(obj?.changelog)) pushError(errors, 'changelog_not_list', 'changelog', 'changelog must be a list');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

function assertPlatform(platform) {
  if (EXCLUDED.includes(platform)) throw new Error(`excluded platform: ${platform}`);
  if (!PLATFORMS.includes(platform)) throw new Error(`unsupported platform: ${platform}`);
}

export function scaffold(platform) {
  assertPlatform(platform);
  const [primary_language, format_default, primary_success_metric] = DEFAULTS[platform];
  return {
    version: '0.1.0',
    primary_language,
    secondary_language: null,
    switch_rule: 'segment by language before training',
    format_default,
    primary_success_metric,
    cadence_ceiling: { posts_per_day: 1 },
    forbidden_imports: platform === 'linkedin' ? [...R1_R32] : [],
    hook_style: { allowed: [], banned: [] },
    cta_style: { allowed: [], banned: [] },
    few_shot: [],
    voice_state: { human_sample_count: 0, last_reanchor: null },
    changelog: [],
    applied_proposal_id: null,
  };
}

export async function writeVoice(platform, obj = scaffold(platform), env = process.env) {
  assertPlatform(platform);
  const value = obj ?? scaffold(platform);
  const dir = resolve('voice_dir', platform, env, env.SOCIAL_POST_CONFIG_PATH).path;
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${platform}.yaml`);
  await writeFile(file, dump(value), 'utf8');
  return Object.freeze({ path: file });
}
