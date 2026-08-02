#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateImage } from '../lib/posting/image-gen.mjs';
import { createClient, schedulePost, splitForX, taipeiWallClockISO } from '../lib/posting/postiz-adapter.mjs';

const DEFAULT_CHANNELS_JSON = new URL('../lib/posting/channels.json', import.meta.url);

export async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const injected = {
    console,
    createClient,
    generateImage,
    now: () => new Date(),
    ...deps,
  };
  const args = parseArgs(argv);
  if (!args.platform) throw new Error('--platform is required');
  if (!args.draft) throw new Error('--draft is required');
  if (args.now && args.at) throw new Error('--now and --at are mutually exclusive');

  const platform = normalizePlatform(args.platform);
  const draftPath = path.resolve(args.draft);
  const draftText = await readFile(draftPath, 'utf8');
  const slug = path.basename(draftPath, path.extname(draftPath));
  const outDir = path.join(path.dirname(draftPath), 'assets');
  const mediaObjs = [];
  let generatedImagePath = null;

  // --image-path reuses a pre-generated png (attended confirm step) instead of regenerating.
  if (args.imagePath) {
    generatedImagePath = path.resolve(args.imagePath);
  } else if (args.image) {
    try {
      const image = await injected.generateImage({
        draftText,
        brandYamlPath: env.SOCIAL_POST_BRAND_YAML,
        outDir,
        slug,
      });
      generatedImagePath = image.pngPath;
    } catch (error) {
      injected.console.error(`image generation failed; continuing without image: ${error.message}`);
    }
  }

  if (platform === 'facebook') {
    const suffix = generatedImagePath ? `; image saved to ${generatedImagePath} for manual attach` : '';
    throw new Error(`facebook personal = attended only${suffix}`);
  }

  const client = injected.createClient({ fetchImpl: globalThis.fetch, env });
  const channelId = await resolveChannelId({ client, platform, account: args.account, env });
  const type = args.now ? 'now' : args.at ? 'schedule' : 'draft';
  const currentDate = injected.now();
  const date = args.at ? taipeiWallClockISO(currentDate, args.at) : currentDate.toISOString();
  const segments = platform === 'x' ? splitForX(draftText) : [draftText.trim()];

  // --dry-run = attended preview: generate image + build payload, but DO NOT upload or send.
  if (args.dryRun) {
    injected.console.log(JSON.stringify({ dryRun: true, platform, channelId, type, date, segments, imagePath: generatedImagePath }, null, 2));
    return;
  }

  if (generatedImagePath) {
    try {
      mediaObjs.push(await client.uploadMedia(generatedImagePath));
    } catch (error) {
      injected.console.error(`media upload failed; continuing without image: ${error.message}`);
    }
  }

  const result = await schedulePost({ platform, channelId, segments, date, type, mediaObjs, client });
  injected.console.log(JSON.stringify(result, null, 2));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--image') {
      out.image = true;
    } else if (arg === '--now') {
      out.now = true;
    } else if (arg === '--dry-run') {
      out.dryRun = true;
    } else if (['--platform', '--draft', '--at', '--account', '--image-path'].includes(arg)) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      out[key] = value;
      i += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return out;
}

async function resolveChannelId({ client, platform, account, env = process.env }) {
  const live = await listLiveChannels(client).catch(() => []);
  const fallback = await readFallbackChannels({ env });
  const blockedChannelIds = readBlockedChannelIds(env);
  const matchesIn = (channels) => channels.filter((channel) => {
    if (channel.disabled) return false;
    if (blockedChannelIds.has(channel.id)) return false;
    if (channel.identifier !== platform) return false;
    if (!account) return true;
    return [channel.name, channel.profile, channel.id].filter(Boolean).includes(account);
  });
  const liveMatches = matchesIn(live);
  const matches = liveMatches.length > 0 ? liveMatches : matchesIn(fallback);
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) throw new Error(`multiple ${platform} channels found; pass --account`);
  const accountSuffix = account ? ` account=${account}` : '';
  throw new Error(
    `no Postiz channel found for ${platform}${accountSuffix}; connect a Postiz integration or create channels.json with entries like `
    + `[{"identifier":"${platform}","name":"account","id":"channel-id"}]`,
  );
}

async function listLiveChannels(client) {
  if (!client || typeof client.listIntegrations !== 'function') return [];
  const channels = await client.listIntegrations();
  return Array.isArray(channels) ? channels : [];
}

async function readFallbackChannels({ env = process.env } = {}) {
  const channelsPath = env.SOCIAL_POST_CHANNELS_JSON ?? DEFAULT_CHANNELS_JSON;
  try {
    const channels = JSON.parse(await readFile(channelsPath, 'utf8'));
    return Array.isArray(channels) ? channels : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function readBlockedChannelIds(env) {
  return new Set(
    String(env.SOCIAL_POST_BLOCKED_CHANNEL_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function normalizePlatform(platform) {
  const normalized = String(platform ?? '').trim().toLowerCase();
  if (!['x', 'linkedin', 'threads', 'facebook'].includes(normalized)) throw new Error(`unsupported platform: ${platform}`);
  return normalized;
}

if (process.argv[1] && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
