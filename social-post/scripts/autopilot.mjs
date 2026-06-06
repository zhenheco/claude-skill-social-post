#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadVoiceContext, MissingVoiceFileError, pickArchetypes } from '../lib/generate/voice-context.mjs';
import { loadConfig, resolve, stateRoot } from '../lib/paths.mjs';
import { scrapeWithFirecrawl as defaultScrapeWithFirecrawl } from '../lib/voice-bootstrap/firecrawl-adapter.mjs';
import { appendRaw, readRaw } from '../lib/voice-bootstrap/raw-store.mjs';
import { distill } from '../lib/voice-bootstrap/distill.mjs';
import { seedVoice as defaultSeedVoice } from '../lib/voice-bootstrap/seed.mjs';
import { parse } from '../lib/yaml.mjs';
import { renderBrief } from './generate-brief.mjs';

const DEFAULT_PLATFORMS = Object.freeze(['threads', 'facebook', 'linkedin', 'x']);
const SENTENCE_PUNCTUATION = /[。，！？.,!?]/u;
const MARKDOWN_LINK = /\[([^\]]+)\]\([^)]+\)/gu;

function valueAfter(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1];
}

function splitCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  return Object.freeze({
    mode: valueAfter(argv, '--mode'),
    platforms: splitCsv(valueAfter(argv, '--platforms')),
    date: valueAfter(argv, '--date'),
  });
}

function logLine(line) {
  process.stdout.write(`${line}\n`);
}

function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

function configPathOf(env, configPath) {
  return configPath ?? env.SOCIAL_POST_CONFIG_PATH;
}

function voiceFile(platform, { env = process.env, configPath } = {}) {
  return path.join(resolve('voice_dir', platform, env, configPath).path, `${platform}.yaml`);
}

async function readYamlIfPresent(file) {
  try {
    return parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function fewShotCount(voice) {
  return Array.isArray(voice?.few_shot) ? voice.few_shot.length : 0;
}

async function currentFewShotCount(platform, options = {}) {
  return fewShotCount(await readYamlIfPresent(voiceFile(platform, options)));
}

async function sourcesFor(platform, { env = process.env, configPath } = {}) {
  const file = path.join(resolve('inspiration', platform, env, configPath).path, 'sources.yaml');
  try {
    const parsed = parse(await readFile(file, 'utf8'));
    return Array.isArray(parsed.sources) ? parsed.sources : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function isReadableSource(source) {
  return ['logged_out_webfetch', 'firecrawl_web', 'owner_paste', 'third_party_scraper'].includes(source.access_mode);
}

async function collectRaw(platform, options = {}) {
  const rows = [];
  for (const source of await sourcesFor(platform, options)) {
    if (source.access_mode === 'auth_required_deferred' || !isReadableSource(source)) continue;
    rows.push(...await readRaw(platform, source.source_id, options));
  }
  return rows;
}

function cleanMarkdownLine(line) {
  return String(line ?? '')
    .replace(MARKDOWN_LINK, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/gu, '')
    .replace(/^[#>*_\-\s`]+/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function extractProseParagraphs(markdown) {
  const seen = new Set();
  const paragraphs = [];
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    const text = cleanMarkdownLine(line);
    if (text.length <= 30) continue;
    if (!SENTENCE_PUNCTUATION.test(text)) continue;
    const hash = sha256(text);
    if (seen.has(hash)) continue;
    seen.add(hash);
    paragraphs.push(text);
  }
  return Object.freeze(paragraphs);
}

async function appendNewRaw(platform, sourceId, texts, options = {}) {
  const existing = await readRaw(platform, sourceId, options);
  const known = new Set(existing.map((row) => sha256(row.text)));
  const fresh = [];
  for (const text of texts) {
    const hash = sha256(text);
    if (known.has(hash)) continue;
    known.add(hash);
    fresh.push({ source_id: sourceId, text, engagement: {} });
  }
  await appendRaw(platform, sourceId, fresh, options);
  return fresh.length;
}

function autopilotRoot(env, configPath) {
  if (env.SOCIAL_POST_AUTOPILOT_ROOT) return env.SOCIAL_POST_AUTOPILOT_ROOT;
  return path.join(path.dirname(stateRoot(env, configPath)), 'autopilot');
}

async function writeText(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
}

function platformList(platforms) {
  return platforms?.length ? Object.freeze([...platforms]) : DEFAULT_PLATFORMS;
}

function errorMessage(error) {
  return error?.message ? String(error.message) : String(error);
}

export async function gatherMode(args, deps = {}) {
  const env = args.env ?? process.env;
  const configPath = configPathOf(env, args.configPath);
  const scrapeWithFirecrawl = deps.scrapeWithFirecrawl ?? defaultScrapeWithFirecrawl;
  const seedVoice = deps.seedVoice ?? defaultSeedVoice;
  const log = deps.log ?? logLine;
  const now = deps.now ?? new Date().toISOString();
  const results = [];
  const platforms = platformList(args.platforms);
  let failedPlatforms = 0;

  for (const platform of platforms) {
    try {
      const sources = await sourcesFor(platform, { env, configPath });
      let scraped = 0;
      let newRaw = 0;
      let eligibleSources = 0;
      let failedSources = 0;
      for (const source of sources) {
        if (source.access_mode !== 'firecrawl_web' || typeof source.url !== 'string' || !source.url.trim()) continue;
        eligibleSources += 1;
        try {
          const markdown = await scrapeWithFirecrawl(source.url, {
            env,
            configPath,
            waitFor: 4000,
            onlyMainContent: false,
          });
          scraped += 1;
          newRaw += await appendNewRaw(platform, source.source_id, extractProseParagraphs(markdown), {
            env,
            configPath,
            now,
          });
        } catch (error) {
          failedSources += 1;
          log(`autopilot gather platform=${platform} source=${source.source_id ?? 'unknown'} error=${errorMessage(error)}`);
        }
      }

      const raw = await collectRaw(platform, { env, configPath });
      const distilled = distill(raw, { minEngagementPct: 0 });
      const existingFewShot = await currentFewShotCount(platform, { env, configPath });
      let wrote = 'yes';
      if (distilled.patterns.length < existingFewShot) {
        wrote = 'skipped-regression';
      } else {
        await seedVoice(platform, distilled, {
          env,
          configPath,
          now,
          mode: 'propose',
          allowUnderfilled: true,
        });
      }
      if (eligibleSources > 0 && scraped === 0 && failedSources > 0) failedPlatforms += 1;
      const line = `autopilot gather platform=${platform} scraped=${scraped} new_raw=${newRaw} patterns=${distilled.patterns.length} wrote=${wrote}`;
      log(line);
      results.push(Object.freeze({ platform, scraped, new_raw: newRaw, patterns: distilled.patterns.length, wrote }));
    } catch (error) {
      failedPlatforms += 1;
      log(`autopilot gather platform=${platform} source=__platform__ error=${errorMessage(error)}`);
    }
  }

  if (platforms.length > 0 && failedPlatforms === platforms.length) throw new Error('autopilot gather failed for all platforms');
  return Object.freeze(results);
}

export async function briefMode(args, deps = {}) {
  if (!args.date) throw new Error('--date is required for brief mode');
  const env = args.env ?? process.env;
  const configPath = configPathOf(env, args.configPath);
  const log = deps.log ?? logLine;
  const dir = path.join(autopilotRoot(env, configPath), 'briefs', args.date);
  const results = [];

  for (const platform of platformList(args.platforms)) {
    let brief;
    try {
      brief = await loadVoiceContext(platform, {
        env,
        configPath,
        corePath: args.corePath ?? env.SOCIAL_POST_CORE_PATH,
      });
    } catch (error) {
      if (error instanceof MissingVoiceFileError) {
        log(`autopilot brief platform=${platform} skipped=missing-voice`);
        results.push(Object.freeze({ platform, skipped: 'missing-voice' }));
        continue;
      }
      throw error;
    }
    if (!brief.seeded) {
      log(`autopilot brief platform=${platform} skipped=unseeded`);
      results.push(Object.freeze({ platform, skipped: 'unseeded' }));
      continue;
    }
    const file = path.join(dir, `${platform}.md`);
    await writeText(file, renderBrief(brief, pickArchetypes(brief, { n: 1 }), null));
    log(`autopilot brief platform=${platform} -> ${file}`);
    results.push(Object.freeze({ platform, path: file }));
  }

  return Object.freeze(results);
}

async function rawCount(platform, options = {}) {
  return (await collectRaw(platform, options)).length;
}

async function voiceSummary(platform, options = {}) {
  const voice = await readYamlIfPresent(voiceFile(platform, options));
  return Object.freeze({
    version: voice?.version ?? 'missing',
    few_shot: fewShotCount(voice),
  });
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

function isTbd(value) {
  return value == null || String(value).trim() === '' || String(value).trim().toUpperCase() === 'TBD';
}

function reportBlockers(config) {
  const blockers = [];
  if (isTbd(config.autopost?.base_url) || isTbd(config.autopost?.api_key)) {
    blockers.push('autopost base_url/api_key TBD');
  }
  return blockers;
}

export async function reportMode(args, deps = {}) {
  if (!args.date) throw new Error('--date is required for report mode');
  const env = args.env ?? process.env;
  const configPath = configPathOf(env, args.configPath);
  const log = deps.log ?? logLine;
  const root = autopilotRoot(env, configPath);
  const config = loadConfig(configPath);
  const rows = [];

  for (const platform of platformList(args.platforms)) {
    const voice = await voiceSummary(platform, { env, configPath });
    rows.push(Object.freeze({
      platform,
      raw_count: await rawCount(platform, { env, configPath }),
      voice_version: voice.version,
      few_shot: voice.few_shot,
      brief: existsSync(path.join(root, 'briefs', args.date, `${platform}.md`)),
      draft: existsSync(path.join(root, 'drafts', args.date, `${platform}.txt`)),
    }));
  }

  const blockers = reportBlockers(config);
  const content = [
    `# Social Autopilot Report ${args.date}`,
    '',
    '| platform | raw_count | voice_version | few_shot | brief | draft |',
    '| --- | ---: | --- | ---: | --- | --- |',
    ...rows.map((row) =>
      `| ${row.platform} | ${row.raw_count} | ${row.voice_version} | ${row.few_shot} | ${yesNo(row.brief)} | ${yesNo(row.draft)} |`,
    ),
    '',
    '## Blockers',
    ...(blockers.length ? blockers.map((item) => `- ${item}`) : ['- none']),
    '',
    '## Needs Human',
    '- Review draft proposals before any post is published.',
    '- FB-native gather remains human-needed until native credentialed collection is configured.',
    '',
  ].join('\n');
  const file = path.join(root, 'reports', `${args.date}.md`);
  await writeText(file, content);
  log(`autopilot report -> ${file}`);
  return Object.freeze({ path: file, rows: Object.freeze(rows), blockers: Object.freeze(blockers) });
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const common = { ...args, env };
  if (args.mode === 'gather') return (await gatherMode(common)).length;
  if (args.mode === 'brief') return (await briefMode(common)).length;
  if (args.mode === 'report') return (await reportMode(common)).rows.length;
  throw new Error('--mode must be gather, brief, or report');
}

if (process.argv[1] && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().then(() => {
    process.exitCode = 0;
  }).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
