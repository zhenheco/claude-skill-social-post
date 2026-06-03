import { assertSameStack } from '../cross-post-firewall.mjs';
import { mechanismFor } from '../registry.mjs';
import { appendPublishLog, readSecret, requestJson } from './rest-base.mjs';

export const DEVTO_KEY_REF = 'op://Dev/DevTo API Key/credential';
const DEVTO_MECHANISM = 'devto_canonical_spoke';
const DEVTO_ENDPOINT = 'https://dev.to/api/articles';

export class NotRepublishError extends Error {
  constructor(message = 'Dev.to input must be an owned republish reference') {
    super(message);
    this.name = 'NotRepublishError';
  }
}

export function republish(ownedRef, options = {}) {
  const registry = options.registry ?? { mechanismFor };
  const firewall = options.firewall ?? { assertSameStack };
  const mechanism = registry.mechanismFor('devto', options);
  if (mechanism !== DEVTO_MECHANISM) throw new Error(`unsupported mechanism for devto: ${mechanism}`);
  firewall.assertSameStack(ownedRef, 'devto', options);
  validateOwnedRef(ownedRef, options.ownedDomains ?? []);

  return {
    surface: 'devto',
    status: 'draft',
    published: false,
    topic_id: ownedRef.topic_id,
    canonical_url: ownedRef.canonical_url,
    payload: {
      article: {
        title: ownedRef.title,
        body_markdown: ownedRef.body_markdown,
        canonical_url: ownedRef.canonical_url,
        published: false,
        tags: ownedRef.tags ?? [],
      },
    },
    human_publish_url: 'https://dev.to/dashboard',
  };
}

export async function submitDraft(draft, options = {}) {
  const token = await readSecret(DEVTO_KEY_REF, options.secretReader);
  const response = await requestJson({
    httpClient: options.httpClient,
    url: options.endpoint ?? DEVTO_ENDPOINT,
    headers: {
      'api-key': token,
      'Content-Type': 'application/json',
    },
    body: { article: { ...draft.payload.article, published: false } },
  });
  const record = publishRecord(draft, response?.id);
  await appendPublishLog(record, options);
  return { ...record, response };
}

function validateOwnedRef(ref, ownedDomains) {
  for (const key of ['topic_id', 'lang', 'title', 'canonical_url', 'body_markdown']) {
    if (!ref?.[key]) throw new NotRepublishError();
  }
  if (!Array.isArray(ownedDomains) || ownedDomains.length === 0) throw new NotRepublishError('owned domain allow-list is required');
  const host = new URL(ref.canonical_url).hostname;
  if (!ownedDomains.includes(host)) throw new NotRepublishError('canonical_url host is not owned');
}

function publishRecord(draft, remoteId) {
  return {
    ts: new Date().toISOString(),
    surface: 'devto',
    topic_id: draft.topic_id,
    canonical_url: draft.canonical_url,
    utm: null,
    status: 'draft',
    published: false,
    remote_id: remoteId,
  };
}
