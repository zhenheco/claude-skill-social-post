import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectFlywheelMaterial } from '../lib/material/flywheel-articles.mjs';

async function withFixture(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'social-flywheel-material-'));
  const skillDir = path.join(home, '.claude/skills/content-flywheel');
  const configPath = path.join(home, 'flywheel-config.yaml');
  const outputDir = path.join(home, 'Content Make');
  const stateDir = path.join(home, '.claude/state/content-flywheel');
  await mkdir(skillDir, { recursive: true });
  await writeFile(configPath, `paths:
  output_dir: "\${HOME}/Content Make"
  state_dir: "\${HOME}/.claude/state/content-flywheel"
  brands_dir: "\${SKILL_DIR}/brands"
`, 'utf8');
  try {
    return await fn({
      home,
      skillDir,
      configPath,
      outputDir,
      stateDir,
      env: { ...process.env, HOME: home, CONTENT_FLYWHEEL_CONFIG: configPath },
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function writeBrand(skillDir, slug, content = {}) {
  const dir = path.join(skillDir, 'brands', slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'brand.yaml'), `site:
  base_url: "${content.baseUrl ?? `https://${slug}.example`}"
  blog_url_prefix: "${content.blogPrefix ?? '/blog'}"
  internal_link_format: "${content.linkFormat ?? '{base_url}{blog_url_prefix}/{slug}'}"
`, 'utf8');
}

async function writeArticle(file, { title = 'A useful AI article', slug = 'useful-ai', url, body = '', omitSlug = false } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `---
title: "${title}"
${omitSlug ? '' : `slug: "${slug}"\n`}${url ? `url: "${url}"\n` : ''}---

Opening paragraph explains the concrete operator lesson with enough detail to become social material.

## First signal

More body.

## Second signal

Another paragraph.
${body}
`, 'utf8');
}

test('collects state articles and builds deterministic material with URL', async () => {
  await withFixture(async ({ skillDir, stateDir, env }) => {
    await writeBrand(skillDir, 'aicycle');
    await writeArticle(
      path.join(stateDir, 'aicycle/content/2026-06-10-useful-ai/article.md'),
      { title: 'Useful AI rollout', slug: 'useful-ai-rollout' },
    );

    const result = await collectFlywheelMaterial({ date: '2026-06-10', brands: ['aicycle'], env });

    assert.equal(Object.isFrozen(result), true);
    assert.equal(result.length, 1);
    assert.deepEqual(
      { brand: result[0].brand, title: result[0].title, url: result[0].url },
      { brand: 'aicycle', title: 'Useful AI rollout', url: 'https://aicycle.example/blog/useful-ai-rollout' },
    );
    assert.match(result[0].excerpt, /Useful AI rollout/);
    assert.match(result[0].excerpt, /First signal/);
    assert.match(result[0].excerpt, /Opening paragraph explains/);
  });
});

test('derives URL from dated article directory when selected file has no slug', async () => {
  await withFixture(async ({ skillDir, stateDir, env }) => {
    await writeBrand(skillDir, 'aicycle');
    await writeArticle(
      path.join(stateDir, 'aicycle/content/2026-01-02-some-topic/article.md'),
      { title: 'Some topic', omitSlug: true },
    );

    const result = await collectFlywheelMaterial({ date: '2026-01-02', brands: ['aicycle'], env });

    assert.equal(result.length, 1);
    assert.equal(result[0].url, 'https://aicycle.example/blog/some-topic');
  });
});

test('collects article-prefixed markdown instead of outline artifacts', async () => {
  await withFixture(async ({ skillDir, stateDir, env }) => {
    await writeBrand(skillDir, 'aicycle');
    const articleDir = path.join(stateDir, 'aicycle/content/2026-06-10-useful-ai');
    await writeArticle(path.join(articleDir, 'outline.md'), { title: 'outline' });
    await writeArticle(path.join(articleDir, 'article.md'), { title: 'Finished article' });

    const result = await collectFlywheelMaterial({ date: '2026-06-10', brands: ['aicycle'], env });

    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'Finished article');
    assert.match(result[0].path, /article\.md$/);
  });
});

test('excludes outline-only article directories from collected material', async () => {
  await withFixture(async ({ skillDir, stateDir, env }) => {
    await writeBrand(skillDir, 'aicycle');
    await writeArticle(
      path.join(stateDir, 'aicycle/content/2026-06-10-outline-only/outline.md'),
      { title: 'outline' },
    );

    const result = await collectFlywheelMaterial({ date: '2026-06-10', brands: ['aicycle'], env });

    assert.deepEqual(result, []);
  });
});

test('falls back to yesterday and filters brands', async () => {
  await withFixture(async ({ skillDir, stateDir, env }) => {
    await writeBrand(skillDir, 'aicycle');
    await writeBrand(skillDir, 'zhenheai');
    await writeArticle(path.join(stateDir, 'aicycle/content/2026-06-09-old/article.md'), { title: 'Yesterday AI' });
    await writeArticle(path.join(stateDir, 'zhenheai/content/2026-06-09-old/article.md'), { title: 'Wrong brand' });

    const result = await collectFlywheelMaterial({ date: '2026-06-10', brands: ['aicycle'], env });

    assert.equal(result.length, 1);
    assert.equal(result[0].brand, 'aicycle');
    assert.equal(result[0].title, 'Yesterday AI');
  });
});

test('falls back to output directory markdown and returns null URL without site config', async () => {
  await withFixture(async ({ outputDir, env }) => {
    await writeArticle(path.join(outputDir, 'n8nmarket/2026-06-10-output.md'), { title: 'Output only', slug: 'output-only' });

    const result = await collectFlywheelMaterial({ date: '2026-06-10', brands: ['n8nmarket'], env });

    assert.equal(result.length, 1);
    assert.equal(result[0].url, null);
    assert.match(result[0].path, /2026-06-10-output\.md$/);
  });
});

test('returns an empty frozen array when no article exists', async () => {
  await withFixture(async ({ env }) => {
    const result = await collectFlywheelMaterial({ date: '2026-06-10', brands: ['aicycle'], env });

    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(result, []);
  });
});

test('keeps excerpts capped for long articles', async () => {
  await withFixture(async ({ skillDir, stateDir, env }) => {
    await writeBrand(skillDir, 'aicycle');
    await writeArticle(path.join(stateDir, 'aicycle/content/2026-06-10-long/article.md'), {
      title: 'Long material',
      body: `\n${'This is a long deterministic paragraph with punctuation. '.repeat(80)}\n`,
    });

    const [material] = await collectFlywheelMaterial({ date: '2026-06-10', brands: ['aicycle'], env });

    assert.ok(material.excerpt.length <= 800);
  });
});
