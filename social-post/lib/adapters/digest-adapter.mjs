import { decisionsFile, atomicWriteJson, readJson } from './adapter-iface.mjs';

const COUNTERS = Object.freeze({
  accept: 'accepted',
  reject: 'rejected',
  snooze: 'snoozed',
});

function nextCategory(current, decision, meta) {
  const counter = COUNTERS[decision];
  if (!counter) throw new Error(`unsupported decision: ${decision}`);
  return {
    total_proposed: (current?.total_proposed ?? 0) + 1,
    accepted: current?.accepted ?? 0,
    rejected: current?.rejected ?? 0,
    snoozed: current?.snoozed ?? 0,
    [counter]: (current?.[counter] ?? 0) + 1,
    last_decision: {
      ts: new Date().toISOString(),
      decision,
      source_proposal_id: meta.source_proposal_id ?? null,
    },
  };
}

export async function record(category, decision, meta = {}, { env = process.env } = {}) {
  const file = decisionsFile(env);
  const decisions = await readJson(file, { _meta: {} });
  const next = structuredClone(decisions);
  next[category] = nextCategory(decisions[category], decision, meta);
  await atomicWriteJson(file, next);
  return Object.freeze({ applied: false, reason: 'propose-only-M1a' });
}

export function assertNoAutoApply() {
  return Object.freeze({ applied: false, reason: 'propose-only-M1a' });
}
