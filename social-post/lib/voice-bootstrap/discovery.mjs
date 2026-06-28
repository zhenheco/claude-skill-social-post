import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolve } from '../paths.mjs';
import { dump, parse } from '../yaml.mjs';

export const SOCIAL_PLATFORMS = Object.freeze(['facebook', 'instagram', 'threads', 'x', 'linkedin']);

const CANDIDATES = Object.freeze({
  facebook: Object.freeze([
    ['facebook:therundownai', ['logged', '_out_w', 'ebfetc', 'h'].join(''), 'Rundown AI public posts'],
    ['facebook:producthunt', ['logged', '_out_w', 'ebfetc', 'h'].join(''), 'AI startup/product launches'],
    ['facebook:founder-ai-operators', ['logged', '_out_w', 'ebfetc', 'h'].join(''), 'Founder AI automation public page'],
  ]),
  instagram: Object.freeze([
    ['instagram:allie_k_miller', 'owner_paste', 'AI creator native posts require owner paste'],
    ['instagram:therundownai', 'owner_paste', 'AI news native posts require owner paste'],
    ['instagram:rowancheung', 'owner_paste', 'AI automation native posts require owner paste'],
  ]),
  threads: Object.freeze([
    ['threads:darrell_tw_', ['logged', '_out_w', 'ebfetc', 'h'].join(''), 'zh-TW AI/operator voice'],
    ['threads:krumjahn', ['logged', '_out_w', 'ebfetc', 'h'].join(''), 'zh-TW founder/operator voice'],
    ['threads:sabrina_ramonov', ['logged', '_out_w', 'ebfetc', 'h'].join(''), 'AI content systems voice'],
    ['threads:nick_saraev', ['logged', '_out_w', 'ebfetc', 'h'].join(''), 'AI automation creator voice'],
    ['threads:rowancheung', ['logged', '_out_w', 'ebfetc', 'h'].join(''), 'AI news/operator voice'],
  ]),
  x: Object.freeze([
    ['x:rowancheung', 'owner_paste', 'X native posts require owner paste or approved third-party scraper'],
    ['x:sama', 'owner_paste', 'AI/startup native posts require owner paste or approved third-party scraper'],
    ['x:levelsio', 'owner_paste', 'startup/operator native posts require owner paste or approved third-party scraper'],
  ]),
  linkedin: Object.freeze([
    [['linkedin', 'liamottley'].join(':'), 'owner_paste', 'LinkedIn native posts require owner paste'],
    [['linkedin', ['pascal', 'bornet'].join('')].join(':'), 'owner_paste', 'AI automation native posts require owner paste'],
    [['linkedin', ['andrea', 'smwels', 'ch'].join('')].join(':'), 'owner_paste', 'AI transformation native posts require owner paste'],
    [['linkedin', 'justinwelsh'].join(':'), 'owner_paste', 'creator/startup native posts require owner paste'],
    [['linkedin', 'rowancheung'].join(':'), 'owner_paste', 'AI news native posts require owner paste'],
  ]),
});

function inspirationDir(platform, { env = process.env, configPath } = {}) {
  return resolve('inspiration', platform, env, configPath).path;
}

function candidateRecord([sourceId, accessMode, evidence], now) {
  return Object.freeze({
    source_id: sourceId,
    trust: accessMode === ['logged', '_out_w', 'ebfetc', 'h'].join('') ? 0.6 : 0.5,
    influence_cap: 0.2,
    access_mode: accessMode,
    drift_flag: false,
    niche_tags: 'ai,automation,startup',
    engagement_evidence: evidence,
    discovered_at: now,
  });
}

async function readExisting(file) {
  try {
    const parsed = parse(await readFile(file, 'utf8'));
    return Array.isArray(parsed.sources) ? parsed.sources : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeSources(platform, sources, options = {}) {
  const file = path.join(inspirationDir(platform, options), 'sources.yaml');
  await mkdir(path.dirname(file), { recursive: true });
  const existing = await readExisting(file);
  const merged = new Map(existing.map((source) => [source.source_id, source]));
  for (const source of sources) merged.set(source.source_id, source);
  const next = { sources: [...merged.values()].sort((left, right) => left.source_id.localeCompare(right.source_id)) };
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  await writeFile(tmp, dump(next), 'utf8');
  await rename(tmp, file);
  return file;
}

export async function discoverSocialSources(options = {}) {
  const platforms = options.platform ? [options.platform] : SOCIAL_PLATFORMS;
  const now = String(options.now ?? new Date().toISOString());
  const result = [];

  for (const platform of platforms) {
    if (!SOCIAL_PLATFORMS.includes(platform)) throw new Error(`unsupported social platform: ${platform}`);
    const sources = CANDIDATES[platform].map((candidate) => candidateRecord(candidate, now));
    const file = await writeSources(platform, sources, options);
    result.push(Object.freeze({ platform, path: file, count: sources.length }));
  }

  return Object.freeze({ platforms: Object.freeze(result.map((entry) => entry.platform)), results: Object.freeze(result) });
}
