import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildImagePrompt, generateImage } from '../lib/posting/image-gen.mjs';

test('buildImagePrompt combines draft, brand style, per-post style, and image guardrails', () => {
  const prompt = buildImagePrompt('AI operators need sharper launch rituals.', {
    colors: ['#101820', '#FEE715'],
    tone: 'direct, precise',
    visual_style: 'minimal editorial diagrams',
  }, 'realistic editorial photograph of a founder workshop');

  assert.match(prompt, /AI operators need sharper launch rituals/);
  assert.match(prompt, /#101820/);
  assert.match(prompt, /direct, precise/);
  assert.match(prompt, /minimal editorial diagrams/);
  assert.match(prompt, /Per-post style: realistic editorial photograph of a founder workshop/);
  assert.match(prompt, /Sophisticated, polished, professional; real depth and texture/);
  assert.match(prompt, /NOT cartoon, NOT childish, no flat clip-art, no mascots, no thick outlines/);
  assert.match(prompt, /NO embedded text/i);
});

test('generateImage writes deterministic prompt/result paths and returns saved png', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'social-image-'));
  const brandYamlPath = path.join(outDir, 'brand.yaml');
  await writeFile(brandYamlPath, 'colors:\n  primary: "#101820"\ntone: calm\nvisual_style: clean geometry\n', 'utf8');
  try {
    const calls = [];
    const execFile = async (file, args) => {
      calls.push({ file, args });
      const workdir = args[args.indexOf('-d') + 1];
      await writeFile(path.join(workdir, 'launch-note.png'), 'png', 'utf8');
    };

    const result = await generateImage({
      draftText: 'Launch note',
      brandYamlPath,
      outDir,
      slug: 'Launch Note!',
      execFile,
    });

    assert.equal(result.pngPath, path.join(outDir, 'launch-note.png'));
    assert.equal(calls[0].file, 'bash');
    assert.equal(calls[0].args.includes('-f'), true);
    assert.equal(calls[0].args.includes('-o'), true);
    assert.match(await readFile(path.join(outDir, 'launch-note.prompt.md'), 'utf8'), /Launch note/);
    assert.equal(await readFile(path.join(outDir, 'launch-note.result.json'), 'utf8'), '');
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('generateImage throws when Codex does not save a png so callers can fail soft', async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'social-image-missing-'));
  try {
    await assert.rejects(
      () => generateImage({
        draftText: 'Draft',
        brandYamlPath: path.join(outDir, 'missing-brand.yaml'),
        outDir,
        slug: 'draft',
        execFile: async () => {},
      }),
      /no png generated/i,
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
