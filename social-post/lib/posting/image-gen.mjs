import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { parse } from '../yaml.mjs';

const execFileDefault = promisify(execFileCallback);
const CODEX_SCRIPT = path.join(os.homedir(), '.claude/skills/codex-agent/scripts/codex-run.sh');

export function buildImagePrompt(draftText, brand = {}, style = '') {
  const brandStyle = summarizeBrand(brand);
  const perPostStyle = String(style ?? '').trim();
  const visualRequirements = [
    'Visual requirements:',
    ...(perPostStyle ? [`Per-post style: ${perPostStyle}`] : []),
    '- Consistent personal brand.',
    '- Minimal, clean composition.',
    '- Sophisticated, polished, professional; real depth and texture.',
    '- NOT cartoon, NOT childish, no flat clip-art, no mascots, no thick outlines.',
    '- No logos unless implied by the brand style.',
    '- NO embedded text in image.',
    '- No captions, watermarks, charts with labels, or readable UI text.',
  ];

  return [
    'Generate one social media image for this post draft.',
    '',
    'Draft:',
    String(draftText ?? '').trim(),
    '',
    'Brand style:',
    brandStyle || 'consistent personal brand, minimal, clean, precise, warm.',
    '',
    ...visualRequirements,
  ].join('\n');
}

export async function generateImage({
  draftText,
  brandYamlPath,
  outDir,
  slug,
  execFile = execFileDefault,
} = {}) {
  if (!draftText || String(draftText).trim() === '') throw new Error('draftText is required');
  if (!outDir) throw new Error('outDir is required');
  const safeSlug = slugify(slug || String(draftText).slice(0, 48));
  await mkdir(outDir, { recursive: true });
  const brand = await readBrand(brandYamlPath);
  const promptPath = path.join(outDir, `${safeSlug}.prompt.md`);
  const resultPath = path.join(outDir, `${safeSlug}.result.json`);
  await writeFile(promptPath, buildImagePrompt(draftText, brand), 'utf8');
  await writeFile(resultPath, '', 'utf8');

  await execFile('bash', [
    CODEX_SCRIPT,
    '-f', promptPath,
    '-s', 'dangerous',
    '-d', outDir,
    '-o', resultPath,
    '-t', '280',
  ]);

  const pngPath = await findGeneratedPng(outDir, safeSlug);
  if (!pngPath) throw new Error(`no png generated in ${outDir}`);
  return { pngPath };
}

async function readBrand(brandYamlPath) {
  if (!brandYamlPath) return {};
  try {
    return parse(await readFile(brandYamlPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

function summarizeBrand(brand) {
  const values = [];
  collectStyleValues(brand, values);
  return values.join('; ');
}

function collectStyleValues(value, out, key = '') {
  if (value == null) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (isStyleKey(key) || looksLikeColor(String(value))) out.push(`${key || 'style'}: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStyleValues(item, out, key);
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) collectStyleValues(childValue, out, childKey);
  }
}

function isStyleKey(key) {
  return /color|palette|tone|visual|style|typography|font|voice|aesthetic|texture|mood/i.test(key);
}

function looksLikeColor(value) {
  return /^#[0-9a-f]{3,8}$/i.test(value);
}

function slugify(value) {
  const slug = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || `image-${Date.now()}`;
}

async function findGeneratedPng(outDir, slug) {
  const exact = path.join(outDir, `${slug}.png`);
  try {
    await stat(exact);
    return exact;
  } catch {}
  const entries = await readdir(outDir, { withFileTypes: true });
  const pngs = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map(async (entry) => {
      const file = path.join(outDir, entry.name);
      return { file, mtimeMs: (await stat(file)).mtimeMs };
    }));
  pngs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return pngs[0]?.file ?? null;
}
