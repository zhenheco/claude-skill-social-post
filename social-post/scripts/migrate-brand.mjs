import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolve } from '../lib/paths.mjs';
import * as coreSchema from '../lib/core-schema.mjs';
import * as voiceSchema from '../lib/voice-schema.mjs';
import { dump, parse } from '../lib/yaml.mjs';

export const FIELD_MAP = Object.freeze({
  core: Object.freeze([
    Object.freeze(['name', 'name']),
    Object.freeze(['identity.niche', 'niche']),
    Object.freeze(['topics', 'values']),
    Object.freeze(['avoid_topics', 'avoid_topics']),
  ]),
  voice: Object.freeze([
    Object.freeze(['voice_oneliner', 'voice_oneliner']),
    Object.freeze(['sentence', 'sentence']),
    Object.freeze(['punctuation', 'punctuation']),
    Object.freeze(['opening', 'opening']),
    Object.freeze(['closing', 'closing']),
    Object.freeze(['emoji', 'emoji']),
    Object.freeze(['hashtag', 'hashtag']),
    Object.freeze(['person', 'person']),
    Object.freeze(['modes', 'modes']),
  ]),
});

const preservedFileName = '.user_custom.preserved';
const scriptPath = fileURLToPath(import.meta.url);

function valueAt(obj, dotted) {
  return dotted.split('.').reduce((value, key) => value?.[key], obj);
}

function hasUsefulValue(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.length > 0 && value !== '|';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some(hasUsefulValue);
  return true;
}

function setIfUseful(target, key, value) {
  if (hasUsefulValue(value)) target[key] = structuredClone(value);
}

function stripInlineComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && line[index - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === '#' && quote == null) return line.slice(0, index).trimEnd();
  }
  return line;
}

function parseLegacyScalar(value) {
  const trimmed = value.trim();
  if (trimmed === '') return {};
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === '[]') return [];
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    return inner ? inner.split(',').map((part) => parseLegacyScalar(part)) : [];
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1).trim();
    const result = {};
    if (!inner) return result;
    for (const pair of inner.split(',')) {
      const [key, ...rest] = pair.split(':');
      result[key.trim()] = parseLegacyScalar(rest.join(':'));
    }
    return result;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseLegacyBrand(content) {
  const root = {};
  let section = null;
  let block = null;
  const lines = content.split(/\r?\n/);

  function flushBlock() {
    if (!block) return;
    if (block.section == null) root[block.key] = block.lines.join('\n').trimEnd();
    else root[block.section][block.key] = block.lines.join('\n').trimEnd();
    block = null;
  }

  for (const raw of lines) {
    if (block) {
      const indent = raw.match(/^ */)[0].length;
      if (!raw.trim() || indent > block.indent) {
        block.lines.push(raw.slice(Math.min(raw.length, block.indent + 2)));
        continue;
      }
      flushBlock();
    }

    const line = stripInlineComment(raw);
    if (!line.trim()) continue;
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (top) {
      section = top[1];
      root[section] = top[2] === '|' ? '' : parseLegacyScalar(top[2]);
      if (top[2] === '|') block = { section: null, key: section, indent: 0, lines: [] };
      continue;
    }
    const child = line.match(/^  ([A-Za-z0-9_-]+):\s*(.*)$/);
    if (child && section) {
      if (!root[section] || Array.isArray(root[section])) root[section] = {};
      if (child[2] === '|') {
        block = { section, key: child[1], indent: 2, lines: [] };
      } else {
        root[section][child[1]] = parseLegacyScalar(child[2]);
      }
    }
  }
  flushBlock();
  return root;
}

function yamlScalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') throw new Error(`unsupported scalar: ${typeof value}`);
  if (
    value &&
    !['null', 'true', 'false'].includes(value) &&
    !/^-?\d+(\.\d+)?$/.test(value) &&
    /^[A-Za-z0-9_.-]+(?: [A-Za-z0-9_.-]+)*$/.test(value)
  ) {
    return value;
  }
  return JSON.stringify(value);
}

function yamlInlineList(value) {
  return `[${value.map(yamlScalar).join(', ')}]`;
}

function dumpCoreObject(obj) {
  const lines = [];
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      if (value.every((item) => item == null || ['string', 'number', 'boolean'].includes(typeof item))) {
        lines.push(`${key}:`);
        for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
        continue;
      }
      lines.push(`${key}:`);
      for (const item of value) {
        const entries = Object.entries(item);
        const [[firstKey, firstValue], ...rest] = entries;
        lines.push(`  - ${firstKey}: ${yamlScalar(firstValue)}`);
        for (const [childKey, childValue] of rest) {
          const child = Array.isArray(childValue) ? yamlInlineList(childValue) : yamlScalar(childValue);
          lines.push(`    ${childKey}: ${child}`);
        }
      }
      continue;
    }
    if (value && typeof value === 'object') {
      lines.push(`${key}:`);
      for (const [childKey, childValue] of Object.entries(value)) {
        lines.push(`  ${childKey}: ${yamlScalar(childValue)}`);
      }
      continue;
    }
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  return `${lines.join('\n')}\n`;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function isoTs(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function assertInside(root, target) {
  const realRoot = path.resolve(root);
  const realTarget = path.resolve(target);
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    throw new Error(`refusing to write outside vault root: ${path.basename(target)}`);
  }
}

function defaultVaultRoot(env = process.env) {
  return path.dirname(resolve('voice_dir', 'facebook', env, env.SOCIAL_POST_CONFIG_PATH).path);
}

function coreScaffoldPath() {
  return fileURLToPath(new URL('../schemas/core.yaml', import.meta.url));
}

async function scaffoldCore() {
  return (await coreSchema.loadCore(coreScaffoldPath())).raw();
}

function buildCore(brand, userCustomSha) {
  const core = structuredClone(brand.coreScaffold);
  for (const [from, to] of FIELD_MAP.core) setIfUseful(core, to, valueAt(brand.source, from));
  core.user_custom_sha256 = userCustomSha;
  return core;
}

function enabledForPlatform(sourceText, platform) {
  const escaped = platform.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\s{2}${escaped}:\\s*\\{\\s*enabled:\\s*(true|false)\\s*\\}`, 'm');
  const match = sourceText.match(pattern);
  return match ? match[1] === 'true' : true;
}

function buildVoice(source, sourceText, platform) {
  const payload = voiceSchema.scaffold(platform);
  payload.enabled = enabledForPlatform(sourceText, platform);
  payload.legacy_voice = {};
  for (const [from, to] of FIELD_MAP.voice) setIfUseful(payload.legacy_voice, to, valueAt(source, from));
  return payload;
}

export function preserveUserCustom(sourceText) {
  const match = sourceText.match(/^user_custom:\s*(?:\|.*)?$/m);
  const bytes = match ? sourceText.slice(match.index) : '';
  return Object.freeze({ bytes, sha256: sha256(bytes) });
}

export function assertNoUserCustomWrite(targets, writeBans) {
  const targetList = Array.isArray(targets) ? targets : [targets];
  for (const target of targetList.map(String)) {
    const parts = target.split(/[\\/]/);
    for (const ban of writeBans) {
      if (target === ban || parts.includes(ban)) {
        throw new Error(`write-ban violation: ${ban}`);
      }
    }
  }
}

async function backupBrand(sourcePath, now = new Date()) {
  const backupPath = `${sourcePath}.bak-${isoTs(now)}`;
  await copyFile(sourcePath, backupPath);
  const [source, backup] = await Promise.all([readFile(sourcePath), readFile(backupPath)]);
  if (!source.equals(backup)) throw new Error('brand.yaml backup byte check failed');
  return backupPath;
}

function voiceErrors(result) {
  return result.errors.map((error) => `${error.path}: ${error.message}`).join('\n');
}

async function validateAll(tempFiles) {
  const coreResult = await coreSchema.validate(tempFiles.core);
  if (!coreResult.valid) throw new Error(`core.yaml validation failed\n${coreResult.errors.join('\n')}`);
  for (const [platform, file] of Object.entries(tempFiles.voice)) {
    const payload = parse(await readFile(file, 'utf8'));
    const result = voiceSchema.validateVoiceFile(payload, { platform });
    if (!result.ok) throw new Error(`${platform}.yaml validation failed\n${voiceErrors(result)}`);
  }
}

async function detectAlreadySplit(vaultRoot, userCustomSha) {
  const corePath = path.join(vaultRoot, 'core.yaml');
  const voiceDir = path.join(vaultRoot, 'voice');
  const preservedPath = path.join(vaultRoot, preservedFileName);
  if (!existsSync(corePath) || !existsSync(voiceDir) || !existsSync(preservedPath)) return false;

  try {
    const loadedCore = await coreSchema.loadCore(corePath);
    if (loadedCore.raw().user_custom_sha256 !== userCustomSha) return false;
    if (sha256(await readFile(preservedPath, 'utf8')) !== userCustomSha) return false;
    for (const platform of voiceSchema.PLATFORMS) {
      const file = path.join(voiceDir, `${platform}.yaml`);
      if (!existsSync(file)) return false;
      const result = voiceSchema.validateVoiceFile(parse(await readFile(file, 'utf8')), { platform });
      if (!result.ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function writeTemps(tempDir, outputs) {
  const tempFiles = { core: path.join(tempDir, 'core.yaml'), voice: {} };
  await writeFile(tempFiles.core, dumpCoreObject(outputs.core), 'utf8');
  for (const [platform, payload] of Object.entries(outputs.voice)) {
    tempFiles.voice[platform] = path.join(tempDir, `${platform}.yaml`);
    await writeFile(tempFiles.voice[platform], dump(payload), 'utf8');
  }
  return tempFiles;
}

async function commitOutputs(vaultRoot, tempFiles, userCustom) {
  const corePath = path.join(vaultRoot, 'core.yaml');
  const voiceDir = path.join(vaultRoot, 'voice');
  const preservedPath = path.join(vaultRoot, preservedFileName);
  for (const target of [corePath, voiceDir, preservedPath]) assertInside(vaultRoot, target);
  await mkdir(voiceDir, { recursive: true });
  await rename(tempFiles.core, corePath);
  for (const [platform, file] of Object.entries(tempFiles.voice)) {
    await rename(file, path.join(voiceDir, `${platform}.yaml`));
  }
  await writeFile(preservedPath, userCustom.bytes, 'utf8');
}

export async function migrate(options = {}) {
  const vaultRoot = path.resolve(options.vaultRoot ?? defaultVaultRoot(options.env));
  const sourcePath = path.join(vaultRoot, 'brand.yaml');
  assertInside(vaultRoot, sourcePath);
  if (!existsSync(sourcePath)) throw new Error('brand.yaml not found');

  const sourceText = await readFile(sourcePath, 'utf8');
  const source = parseLegacyBrand(sourceText);
  const userCustom = preserveUserCustom(sourceText);
  if (await detectAlreadySplit(vaultRoot, userCustom.sha256)) {
    return Object.freeze({
      noop: true,
      corePath: path.join(vaultRoot, 'core.yaml'),
      userCustomSha256: userCustom.sha256,
    });
  }
  const coreScaffold = await scaffoldCore();
  const backupPath = await backupBrand(sourcePath, options.now);
  let tempDir;

  try {
    tempDir = await mkdtemp(path.join(vaultRoot, '.migrate-brand-'));
    const core = buildCore({ source, coreScaffold }, userCustom.sha256);
    const voice = {};
    for (const platform of voiceSchema.PLATFORMS) {
      const payload = buildVoice(source, sourceText, platform);
      voice[platform] = options.transformVoice ? options.transformVoice(platform, payload) : payload;
    }
    const tempFiles = await writeTemps(tempDir, { core, voice });
    await validateAll(tempFiles);
    await commitOutputs(vaultRoot, tempFiles, userCustom);
    return Object.freeze({
      noop: false,
      backupPath,
      corePath: path.join(vaultRoot, 'core.yaml'),
      userCustomSha256: userCustom.sha256,
    });
  } catch (error) {
    throw new Error(`Migration aborted: ${error.message}`);
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  try {
    const result = await migrate();
    console.log(result.noop ? 'noop: already migrated' : `migrated: ${result.corePath}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

function isCliEntry() {
  if (!process.argv[1] || process.argv[1] === '-') return false;
  try {
    const argPath = path.resolve(process.argv[1]);
    const realArgPath = realpathSync(argPath);
    const realScriptPath = realpathSync(scriptPath);
    return realArgPath === realScriptPath || pathToFileURL(realArgPath).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isCliEntry()) await main();
