import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { parse } from '../yaml.mjs';

const DEFAULT_LIMIT = 3;
const EXCERPT_CAP = 800;

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function previousDate(date) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function flywheelConfigPath(env) {
  return env.CONTENT_FLYWHEEL_CONFIG ?? path.join(env.HOME, '.claude/skills/content-flywheel/config.yaml');
}

function flywheelSkillDir(env) {
  return env.CONTENT_FLYWHEEL_SKILL_DIR ?? path.join(env.HOME, '.claude/skills/content-flywheel');
}

function expandTemplate(template, env) {
  return String(template ?? '').replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, key) => {
    if (key === 'HOME') return env.HOME;
    if (key === 'SKILL_DIR') return flywheelSkillDir(env);
    return match;
  });
}

async function readYaml(file) {
  return parse(await readFile(file, 'utf8'));
}

async function readYamlIfPresent(file) {
  try {
    return await readYaml(file);
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function dirEntries(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function selectedArticleMarkdownFiles(articleDir, entries) {
  const markdownFiles = entries
    .filter((child) => child.isFile() && child.name.endsWith('.md') && !child.name.startsWith('.'))
    .map((child) => path.join(articleDir, child.name))
    .sort((a, b) => {
      const aArticle = path.basename(a) === 'article.md' ? 0 : 1;
      const bArticle = path.basename(b) === 'article.md' ? 0 : 1;
      return aArticle - bArticle || a.localeCompare(b);
    });
  const tiers = [
    markdownFiles.filter((file) => path.basename(file, '.md').startsWith('article')),
    markdownFiles.filter((file) => path.basename(file) === 'index.md'),
    markdownFiles.filter((file) => !/^(outline|notes?|draft|brief|review)/iu.test(path.basename(file, '.md'))),
  ];
  return tiers.find((tier) => tier.length) ?? [];
}

async function discoverBrands({ requested, paths }) {
  if (Array.isArray(requested) && requested.length) return Object.freeze([...requested]);
  const found = new Set();
  for (const base of [paths.brandsDir, paths.stateDir, paths.outputDir]) {
    for (const entry of await dirEntries(base)) {
      if (entry.isDirectory()) found.add(entry.name);
    }
  }
  return Object.freeze([...found].sort());
}

async function stateArticleFiles(paths, brand, date) {
  const contentDir = path.join(paths.stateDir, brand, 'content');
  const entries = await dirEntries(contentDir);
  const files = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${date}-`)) continue;
    const articleDir = path.join(contentDir, entry.name);
    const articleFiles = selectedArticleMarkdownFiles(articleDir, await dirEntries(articleDir));
    files.push(...articleFiles);
  }
  return Object.freeze(files);
}

async function outputArticleFiles(paths, brand, date) {
  return Object.freeze((await dirEntries(path.join(paths.outputDir, brand)))
    .filter((entry) => entry.isFile() && entry.name.startsWith(date) && entry.name.endsWith('.md'))
    .map((entry) => path.join(paths.outputDir, brand, entry.name))
    .sort());
}

function splitFrontmatter(markdown) {
  const text = String(markdown ?? '');
  if (!text.startsWith('---')) return Object.freeze({ frontmatter: {}, body: text });
  const end = text.indexOf('\n---', 3);
  if (end === -1) return Object.freeze({ frontmatter: {}, body: text });
  return Object.freeze({
    frontmatter: parse(text.slice(3, end)),
    body: text.slice(end + 4),
  });
}

function cleanMarkdownLine(line) {
  return String(line ?? '')
    .replace(/!\[[^\]]*\]\([^)]+\)/gu, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replace(/^[>*_\-\s`]+/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function proseParagraphs(markdown) {
  const paragraphs = [];
  for (const block of String(markdown ?? '').split(/\n{2,}/u)) {
    const text = cleanMarkdownLine(block.replace(/\r?\n/gu, ' '));
    if (text.length <= 30) continue;
    if (/^#/u.test(text)) continue;
    paragraphs.push(text);
  }
  return paragraphs;
}

function h2Headings(markdown) {
  return String(markdown ?? '')
    .split(/\r?\n/u)
    .map((line) => line.match(/^##\s+(.+)$/u)?.[1])
    .filter(Boolean)
    .map(cleanMarkdownLine)
    .slice(0, 2);
}

function excerptFor({ title, body }) {
  const parts = [title, ...h2Headings(body), ...proseParagraphs(body).slice(0, 1)].filter(Boolean);
  return parts.join('\n').slice(0, EXCERPT_CAP);
}

function siteBase(brandConfig) {
  return brandConfig.site?.base_url ?? brandConfig.site?.site_url ?? brandConfig.base_url ?? brandConfig.site_url ?? null;
}

function slugFromDatedArticleDirectory(file) {
  const articleDir = path.basename(path.dirname(file));
  return articleDir.match(/^\d{4}-\d{2}-\d{2}-(.+)$/u)?.[1] ?? null;
}

function buildUrl(frontmatter, brandConfig, fallbackSlug = null) {
  const baseUrl = siteBase(brandConfig);
  if (!baseUrl) return null;
  const slugOrUrl = frontmatter.url ?? frontmatter.slug ?? fallbackSlug;
  if (!slugOrUrl) return null;
  const raw = String(slugOrUrl);
  if (/^https?:\/\//u.test(raw)) return raw;
  if (raw.startsWith('/')) return new URL(raw, baseUrl).toString();
  const site = brandConfig.site ?? {};
  const format = site.internal_link_format;
  if (format) {
    return format
      .replace(/\{base_url\}/gu, baseUrl.replace(/\/$/u, ''))
      .replace(/\{blog_url_prefix\}/gu, site.blog_url_prefix ?? '')
      .replace(/\{slug\}/gu, raw);
  }
  const prefix = site.blog_url_prefix ?? '/blog';
  return `${baseUrl.replace(/\/$/u, '')}${prefix.startsWith('/') ? prefix : `/${prefix}`}/${raw}`;
}

async function loadPaths(env) {
  const configPath = flywheelConfigPath(env);
  const config = await readYaml(configPath);
  const outputDir = expandTemplate(config.paths?.output_dir, env);
  const stateDir = expandTemplate(config.paths?.state_dir, env);
  const brandsDir = expandTemplate(config.paths?.brands_dir ?? '${SKILL_DIR}/brands', env);
  return Object.freeze({ outputDir, stateDir, brandsDir });
}

async function materialFromFile({ file, brand, paths }) {
  const { frontmatter, body } = splitFrontmatter(await readFile(file, 'utf8'));
  const brandConfig = await readYamlIfPresent(path.join(paths.brandsDir, brand, 'brand.yaml'));
  const title = frontmatter.title ?? path.basename(file, path.extname(file));
  return Object.freeze({
    brand,
    title,
    url: buildUrl(frontmatter, brandConfig, slugFromDatedArticleDirectory(file)),
    excerpt: excerptFor({ title, body }),
    path: file,
  });
}

export async function collectFlywheelMaterial({ date, brands, limit = DEFAULT_LIMIT, env = process.env } = {}) {
  const effectiveDate = date ?? todayString();
  const dates = Object.freeze([effectiveDate, previousDate(effectiveDate)]);
  const paths = await loadPaths(env);
  const brandList = await discoverBrands({ requested: brands, paths });
  const items = [];

  for (const candidateDate of dates) {
    for (const brand of brandList) {
      const files = await stateArticleFiles(paths, brand, candidateDate);
      for (const file of files) items.push(await materialFromFile({ file, brand, paths }));
      if (items.length >= limit) return Object.freeze(items.slice(0, limit));
    }
    if (items.length) return Object.freeze(items.slice(0, limit));

    for (const brand of brandList) {
      const files = await outputArticleFiles(paths, brand, candidateDate);
      for (const file of files) items.push(await materialFromFile({ file, brand, paths }));
      if (items.length >= limit) return Object.freeze(items.slice(0, limit));
    }
    if (items.length) return Object.freeze(items.slice(0, limit));
  }

  return Object.freeze([]);
}
