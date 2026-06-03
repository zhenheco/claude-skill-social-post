import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { stateRoot } from './paths.mjs';
import {
  jaccard5,
  longestCommonSubstring,
  longestCommonWordSequence,
  scriptOf,
} from './gates/text-sim.mjs';

const DEFAULT_SPACING_WINDOW_DAYS = 7;
const SIMILARITY_THRESHOLD = 0.72;
const DAY_MS = 24 * 60 * 60 * 1000;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeTopic(text) {
  return String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function topicId(text) {
  return `topic_${hash(normalizeTopic(text)).slice(0, 12)}`;
}

export function ideaLedgerPath(options = {}) {
  const root = options.env?.SOCIAL_EVOLVE_STATE_ROOT ?? stateRoot(options.env ?? process.env, options.configPath);
  return path.join(root, 'ideas.jsonl');
}

async function appendJsonLine(file, row) {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(row)}\n`, 'utf8');
}

async function readRows(options = {}) {
  const file = ideaLedgerPath(options);
  let content = '';
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`ideas.jsonl:${index + 1}: ${error.message}`);
      }
    });
}

function similarity(left, right) {
  const mode = scriptOf(`${left} ${right}`) === 'latin' ? 'word' : 'char';
  const lcs = mode === 'word' ? longestCommonWordSequence(left, right) : longestCommonSubstring(left, right);
  const shortest = Math.max(1, Math.min(left.split(/\s+/).length, right.split(/\s+/).length));
  return Math.max(jaccard5(left, right, mode), lcs.length / shortest);
}

function withinWindow(createdTs, now, days) {
  const age = new Date(now).getTime() - new Date(createdTs).getTime();
  return age >= 0 && age <= days * DAY_MS;
}

export async function readIdeas(options = {}) {
  const rows = await readRows(options);
  const topics = new Map();
  for (const row of rows) {
    if (row.type === 'topic') {
      topics.set(row.topic_id, { ...row, editions: [] });
      continue;
    }
    if (row.type === 'edition' && topics.has(row.topic_id)) {
      topics.get(row.topic_id).editions.push(row.edition);
    }
  }
  return deepFreeze([...topics.values()]);
}

export async function readIdea(topic_id, options = {}) {
  return (await readIdeas(options)).find((idea) => idea.topic_id === topic_id) ?? null;
}

export async function logTopic(text, options = {}) {
  const normalized = normalizeTopic(text);
  if (!normalized) throw new Error('topic text is required');
  const now = options.now ?? new Date().toISOString();
  const spacingWindowDays = options.spacingWindowDays ?? DEFAULT_SPACING_WINDOW_DAYS;
  const id = topicId(normalized);
  const sourceTextHash = hash(normalized);
  const ideas = await readIdeas(options);

  const existing = ideas.find((idea) => idea.source_text_hash === sourceTextHash);
  if (existing) return deepFreeze({ logged: true, topic_id: existing.topic_id, duplicate: true });

  for (const idea of ideas) {
    if (!withinWindow(idea.created_ts, now, spacingWindowDays)) continue;
    if (similarity(normalized, idea.normalized_text) >= SIMILARITY_THRESHOLD) {
      return deepFreeze({ logged: false, reason: 'topic_spacing', collides_with: idea.topic_id });
    }
  }

  const row = {
    type: 'topic',
    topic_id: id,
    created_ts: new Date(now).toISOString(),
    source_text_hash: sourceTextHash,
    source_text: String(text),
    normalized_text: normalized,
    editions: [],
    spacing_window_days: spacingWindowDays,
  };
  await appendJsonLine(ideaLedgerPath(options), row);
  return deepFreeze({ logged: true, topic_id: id });
}

export async function addEdition(topic_id, edition, options = {}) {
  const idea = await readIdea(topic_id, options);
  if (!idea) throw new Error(`unknown topic_id: ${topic_id}`);
  const row = {
    type: 'edition',
    topic_id,
    created_ts: new Date(options.now ?? Date.now()).toISOString(),
    edition: structuredClone(edition),
  };
  await appendJsonLine(ideaLedgerPath(options), row);
  return deepFreeze(row.edition);
}
