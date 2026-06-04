import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ExcludedPlatformError, UnknownPlatformError, assertAllowed, normalizePlatform } from '../registry.mjs';
import { resolve } from '../paths.mjs';
import { parse } from '../yaml.mjs';
import { PLATFORMS } from '../voice-schema.mjs';

export class MissingVoiceFileError extends Error {
  constructor(platform, file) {
    super(`missing voice file for ${platform}: ${file}`);
    this.name = 'MissingVoiceFileError';
    this.platform = platform;
    this.file = file;
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().startsWith('[') && value.trim().endsWith(']')) {
    const inner = value.trim().slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => item.trim()).filter(Boolean);
  }
  if (value == null) return [];
  return [value];
}

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function assertVoicePlatform(platform) {
  assertAllowed(platform, { caller: 'loadVoiceContext' });
  const normalized = normalizePlatform(platform);
  if (!PLATFORMS.includes(normalized)) throw new UnknownPlatformError(platform);
  return normalized;
}

function defaultCorePath(env) {
  return path.join(env.HOME ?? '', 'Documents/CC Cli/brands/personal/core.yaml');
}

function voicePathFor(platform, { env, voiceDir, configPath }) {
  const dir = voiceDir ?? resolve('voice_dir', platform, env, configPath).path;
  return path.join(dir, `${platform}.yaml`);
}

async function readYaml(file) {
  return parse(await readFile(file, 'utf8'));
}

function apexCtas(core) {
  return asArray(core.objective_hierarchy)
    .filter((entry) => entry?.tier === 'apex')
    .flatMap((entry) => asArray(entry.metrics));
}

function languageKey(value) {
  const text = String(value ?? '').toLowerCase();
  if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(text) || text.startsWith('zh')) return 'zh';
  if (text.startsWith('en')) return 'en';
  return text ? 'en' : undefined;
}

function styleFingerprintForLanguage(voice) {
  const byLang = asPlainObject(voice.style_fingerprint_by_lang);
  const targetLanguage = String(voice.primary_language ?? '');
  return asPlainObject(byLang[targetLanguage] ?? voice.style_fingerprint);
}

export async function loadVoiceContext(platform, options = {}) {
  const env = options.env ?? process.env;
  const normalized = assertVoicePlatform(platform);
  const configPath = options.configPath ?? env.SOCIAL_POST_CONFIG_PATH;
  const corePath = options.corePath ?? env.SOCIAL_POST_CORE_PATH ?? defaultCorePath(env);
  const voicePath = voicePathFor(normalized, {
    env,
    voiceDir: options.voiceDir,
    configPath,
  });

  const core = await readYaml(corePath);
  let voice;
  try {
    voice = await readYaml(voicePath);
  } catch (error) {
    if (error.code === 'ENOENT') throw new MissingVoiceFileError(normalized, voicePath);
    throw error;
  }

  const fewShot = asArray(voice.few_shot).filter((entry) => entry && typeof entry === 'object');
  const seeded = fewShot.length > 0;
  const brief = {
    platform: normalized,
    language: voice.primary_language,
    seeded,
    identity: {
      name: core.name,
      niche: core.niche,
      values: asArray(core.values),
    },
    avoid_topics: asArray(core.avoid_topics),
    voice_directive: asPlainObject(core.voice_directive),
    apex_ctas: apexCtas(core),
    automation_policy: asPlainObject(core.automation_policy),
    format_default: voice.format_default,
    hook_archetypes: seeded ? asArray(voice.hook_style?.allowed) : [],
    few_shot: seeded ? fewShot : [],
    style_fingerprint: styleFingerprintForLanguage(voice),
    cta_style: asPlainObject(voice.cta_style),
    forbidden_imports: asArray(voice.forbidden_imports),
    cadence_ceiling: asPlainObject(voice.cadence_ceiling),
  };

  return deepFreeze(brief);
}

export function pickArchetypes(brief, options = {}) {
  if (!brief?.seeded) return [];
  const archetypes = asArray(brief.hook_archetypes);
  if (!archetypes.length) return [];
  const recent = asArray(options.recent).map(String);
  const recentSet = new Set(recent);
  const limit = Math.max(0, Number(options.n ?? 1));
  if (!limit) return [];

  const lastRecent = [...recent].reverse().find((name) => archetypes.includes(name));
  const start = lastRecent ? (archetypes.indexOf(lastRecent) + 1) % archetypes.length : 0;
  const rotated = [...archetypes.slice(start), ...archetypes.slice(0, start)];
  const ordered = [
    ...rotated.filter((name) => !recentSet.has(name)),
    ...rotated.filter((name) => recentSet.has(name)),
  ];
  const targetLanguage = languageKey(options.language ?? brief.language);
  const byPattern = new Map();
  for (const entry of asArray(brief.few_shot)) {
    const entries = byPattern.get(entry.pattern) ?? [];
    entries.push(entry);
    byPattern.set(entry.pattern, entries);
  }

  return ordered
    .map((archetype) => {
      const entries = byPattern.get(archetype) ?? [];
      const entry = entries.find((candidate) => languageKey(candidate.skeleton) === targetLanguage) ?? entries[0];
      return entry?.skeleton ? { archetype, skeleton: entry.skeleton } : null;
    })
    .filter(Boolean)
    .slice(0, limit);
}
