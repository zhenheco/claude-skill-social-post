import { execFile as execFileCallback } from 'node:child_process';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { stateRoot } from '../paths.mjs';
import { mechanismFor } from '../registry.mjs';

export const POSTIZ_KEY_REF = 'op://Dev/Postiz API Key/credential';
const POSTIZ_BASE = 'https://api.postiz.com/public/v1';
const REQUIRED_MECHANISM = 'postiz_official_api';
const TAIPEI_TZ = 'Asia/Taipei';
const execFileDefault = promisify(execFileCallback);

const SETTINGS = Object.freeze({
  x: Object.freeze({ __type: 'x', who_can_reply_post: 'everyone' }),
  linkedin: Object.freeze({ __type: 'linkedin' }),
  threads: Object.freeze({ __type: 'threads' }),
  facebook: Object.freeze({ __type: 'facebook' }),
});

export class PlatformFrozenError extends Error {
  constructor(platform) {
    super(`platform frozen: ${platform}`);
    this.name = 'PlatformFrozenError';
    this.platform = platform;
  }
}

export class ChallengeFrozenError extends Error {
  constructor(platform, reason) {
    super(`challenge detected; platform frozen: ${platform}`);
    this.name = 'ChallengeFrozenError';
    this.platform = platform;
    this.reason = reason;
  }
}

export class UnsupportedMechanismError extends Error {
  constructor(platform, mechanism) {
    super(`unsupported mechanism for ${platform}: ${mechanism}`);
    this.name = 'UnsupportedMechanismError';
    this.platform = platform;
    this.mechanism = mechanism;
  }
}

export class ChallengeSignal extends Error {
  constructor(reason = 'challenge') {
    super(reason);
    this.name = 'ChallengeSignal';
    this.reason = reason;
  }
}

export function createClient({ fetchImpl, env = process.env, baseUrl = POSTIZ_BASE, execFileImpl = execFileDefault } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');

  async function request(endpoint, init = {}) {
    const key = await resolvePostizKey({ env, execFileImpl });
    const response = await fetchImpl(`${baseUrl}${endpoint}`, {
      ...init,
      headers: {
        Authorization: key,
        ...(init.headers ?? {}),
      },
    });
    const body = typeof response.json === 'function' ? await response.json() : null;
    if (isChallengeResponse(response, body)) throw new ChallengeSignal('challenge');
    if (!response.ok) throw new Error(`Postiz request failed: ${response.status}`);
    return body;
  }

  return {
    async createPost(payload) {
      return await request('/posts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    },
    async listIntegrations() {
      return await request('/integrations');
    },
    async uploadMedia(pngPath) {
      return await uploadMedia(pngPath, { fetchImpl, env, baseUrl, execFileImpl });
    },
  };
}

export async function uploadMedia(pngPath, { fetchImpl, env = process.env, baseUrl = POSTIZ_BASE, execFileImpl = execFileDefault } = {}) {
  if (!pngPath) throw new Error('pngPath is required');
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
  const key = await resolvePostizKey({ env, execFileImpl });
  const form = new FormData();
  const bytes = await readFile(pngPath);
  form.append('file', new Blob([bytes], { type: mimeFor(pngPath) }), path.basename(pngPath));
  const response = await fetchImpl(`${baseUrl}/upload`, {
    method: 'POST',
    headers: { Authorization: key },
    body: form,
  });
  const body = typeof response.json === 'function' ? await response.json() : null;
  if (!response.ok) throw new Error(`Postiz upload failed: ${response.status}`);
  if (!body?.id || !body?.path) throw new Error('Postiz upload response missing id/path');
  return body;
}

export function taipeiWallClockISO(date, time) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error('valid date is required');
  const match = String(time ?? '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error('time must be HH:MM');
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TAIPEI_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  // Taipei is UTC+8 (no DST). HH:MM is a Taipei wall-clock time; Postiz interprets `date` as UTC,
  // so the true instant is the Taipei Y-M-D HH:MM minus 8h. (Sending TW time as-is in Z schedules 8h late.)
  const utcMs = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(match[1]), Number(match[2]), 0,
  ) - 8 * 60 * 60 * 1000;
  return new Date(utcMs).toISOString();
}

export function splitForX(text, limit = 280) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
  const normalized = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const chunks = normalized
    .split(/\n{2,}/)
    .flatMap((paragraph) => paragraph.match(/[^.!?。！？]+[.!?。！？]?/gu) ?? [paragraph])
    .map((chunk) => chunk.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .flatMap((chunk) => chunk.length <= limit ? [chunk] : splitWords(chunk, limit));

  const segments = [];
  let current = '';
  for (const chunk of chunks) {
    const separator = current ? ' ' : '';
    if ((current + separator + chunk).length <= limit) {
      current = `${current}${separator}${chunk}`;
      continue;
    }
    if (current) segments.push(current);
    current = chunk;
  }
  if (current) segments.push(current);
  return segments;
}

export async function schedulePost({ platform, channelId, segments, date, type = 'schedule', mediaObjs = [], client } = {}) {
  if (!client || typeof client.createPost !== 'function') throw new Error('Postiz client required');
  const payload = buildSchedulePayload({ platform, channelId, segments, date, type, mediaObjs });
  return await client.createPost(payload);
}

export function buildSchedulePayload({ platform, channelId, segments, date, type = 'schedule', mediaObjs = [] } = {}) {
  const provider = normalizeProvider(platform);
  if (!channelId) throw new Error('channelId is required');
  if (!['schedule', 'now', 'draft'].includes(type)) throw new Error(`unsupported post type: ${type}`);
  if (!date) throw new Error('date is required');
  const cleanSegments = (segments ?? []).map((segment) => String(segment ?? '').trim()).filter(Boolean);
  if (cleanSegments.length === 0) throw new Error('segments are required');
  const values = provider === 'x'
    ? cleanSegments.map((content) => ({ content, image: [...mediaObjs] }))
    : [{ content: cleanSegments.join('\n\n'), image: [...mediaObjs] }];
  return {
    type,
    date,
    shortLink: false,
    tags: [],
    posts: [{
      integration: { id: channelId },
      value: values,
      settings: { ...SETTINGS[provider] },
    }],
  };
}

export async function post({ platform, draft, client, registry = { mechanismFor }, env = process.env, now = () => new Date().toISOString() }) {
  if (await isFrozen(platform, { env })) throw new PlatformFrozenError(platform);
  const mechanism = registry.mechanismFor(platform, { env });
  if (mechanism !== REQUIRED_MECHANISM) throw new UnsupportedMechanismError(platform, mechanism);
  if (!client || typeof client.createPost !== 'function') throw new Error('Postiz client required');

  const payload = toPostizPayload(platform, draft);
  try {
    const result = await client.createPost(payload);
    await appendPostingLog(platform, {
      platform,
      mechanism: REQUIRED_MECHANISM,
      post_id: result?.post_id ?? result?.id,
      op_ref: POSTIZ_KEY_REF,
      ts: now(),
    }, { env });
    return { platform, mechanism: REQUIRED_MECHANISM, post_id: result?.post_id ?? result?.id, published: false };
  } catch (error) {
    if (!isChallengeError(error)) throw error;
    await freezePlatform(platform, { reason: error.reason ?? error.message, env, now });
    throw new ChallengeFrozenError(platform, error.reason ?? error.message);
  }
}

export function toPostizPayload(platform, draft) {
  if (!platform) throw new Error('platform is required');
  if (!draft?.text) throw new Error('draft.text is required');
  const base = { platform, content: draft.text, type: draft.document ? 'document' : 'text' };
  return draft.document ? { ...base, document: { ...draft.document } } : base;
}

async function resolvePostizKey({ env, execFileImpl }) {
  if (env.POSTIZ_API_KEY) return env.POSTIZ_API_KEY;
  const result = await execFileImpl('op', ['read', POSTIZ_KEY_REF]);
  const key = String(result?.stdout ?? '').trim();
  if (!key) throw new Error('POSTIZ_API_KEY is required');
  return key;
}

function normalizeProvider(platform) {
  const provider = String(platform ?? '').trim().toLowerCase();
  if (!SETTINGS[provider]) throw new Error(`unsupported platform: ${platform}`);
  return provider;
}

function splitWords(text, limit) {
  const words = text.split(/\s+/).filter(Boolean);
  const segments = [];
  let current = '';
  for (const word of words) {
    if (word.length > limit) throw new Error('cannot split X text without breaking a word');
    const separator = current ? ' ' : '';
    if ((current + separator + word).length <= limit) {
      current = `${current}${separator}${word}`;
      continue;
    }
    if (current) segments.push(current);
    current = word;
  }
  if (current) segments.push(current);
  return segments;
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.avif') return 'image/avif';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
  if (ext === '.mp4') return 'video/mp4';
  return 'application/octet-stream';
}

export async function isFrozen(platform, { env = process.env } = {}) {
  try {
    const content = await readFile(accountHealthPath(platform, env), 'utf8');
    return /frozen:\s*true/.test(content);
  } catch {
    return false;
  }
}

export async function freezePlatform(platform, { reason, env = process.env, now = () => new Date().toISOString() } = {}) {
  const file = accountHealthPath(platform, env);
  await mkdir(path.dirname(file), { recursive: true });
  const body = `platform: ${platform}\nfrozen: true\nreason: ${reason ?? 'challenge'}\nts: ${now()}\n`;
  const temp = `${file}.tmp`;
  await writeFile(temp, body, 'utf8');
  await rename(temp, file);
}

function isChallengeResponse(response, body) {
  if (response?.status === 403) return true;
  return /challenge|login_wall|unusual_activity/i.test(JSON.stringify(body ?? {}));
}

function isChallengeError(error) {
  return error instanceof ChallengeSignal || /challenge|login_wall|unusual_activity/i.test(String(error?.message ?? ''));
}

async function appendPostingLog(platform, record, { env }) {
  const file = path.join(platformRoot(platform, env), 'posting-log.jsonl');
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
}

function accountHealthPath(platform, env) {
  return path.join(platformRoot(platform, env), 'account-health.yaml');
}

function platformRoot(platform, env) {
  const root = env.SOCIAL_EVOLVE_STATE_ROOT ?? stateRoot(env);
  return path.join(root, platform);
}
