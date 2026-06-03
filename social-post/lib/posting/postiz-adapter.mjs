import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { stateRoot } from '../paths.mjs';
import { mechanismFor } from '../registry.mjs';

export const POSTIZ_KEY_REF = 'op://Dev/Postiz API Key';
const POSTIZ_BASE = 'https://api.postiz.com/public/v1';
const REQUIRED_MECHANISM = 'postiz_official_api';

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

export function createClient({ fetchImpl, env = process.env, baseUrl = POSTIZ_BASE } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
  const key = env.POSTIZ_API_KEY;
  if (!key) throw new Error('POSTIZ_API_KEY is required');
  return {
    async createPost(payload) {
      const response = await fetchImpl(`${baseUrl}/posts`, {
        method: 'POST',
        headers: {
          Authorization: key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = typeof response.json === 'function' ? await response.json() : null;
      if (isChallengeResponse(response, body)) throw new ChallengeSignal('challenge');
      if (!response.ok) throw new Error(`Postiz request failed: ${response.status}`);
      return body;
    },
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
