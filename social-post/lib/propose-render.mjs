function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function renderScoreBlock(name, score) {
  return [
    `${name}:`,
    `  value: ${score.value ?? 'absent'}`,
    `  n: ${score.n}`,
    `  effect_size: ${score.effect_size}`,
    `  source_metric: ${score.source_metric ?? 'absent'}`,
    `  status: ${score.status}`,
  ].join('\n');
}

function renderEvidence(evidence) {
  if (evidence.length === 0) return ['evidence:', '  - none'].join('\n');
  return ['evidence:', ...evidence.map((entry) => `  - ${oneLine(entry)}`)].join('\n');
}

function renderTrustPreview(preview) {
  const parts = ['trust-delta PREVIEW (display only)'];
  if (preview.dimension) parts.push(`dimension: ${preview.dimension}`);
  if (preview.delta != null) parts.push(`delta: ${preview.delta}`);
  if (preview.current_lb != null) parts.push(`from: ${preview.current_lb}`);
  if (preview.would_be_lb != null) parts.push(`to: ${preview.would_be_lb}`);
  if (preview.eligible === false && preview.reason) parts.push(`reason: ${preview.reason}`);
  return parts.join(' | ');
}

export function renderProposal(proposal) {
  const lines = [
    `- [ ] proposal_id: ${proposal.proposal_id}`,
    `  platform: ${proposal.platform}`,
    `  kind: ${proposal.kind}`,
    `  ts: ${proposal.ts}`,
    `  voice_version: ${proposal.voice_version ?? 'unknown'}`,
    `  source_candidate_ids: ${proposal.source_candidate_ids.join(', ')}`,
    `  evidence_ids: ${proposal.evidence_ids.join(', ')}`,
  ];

  if (proposal.hard_no_auto_apply) {
    lines.push('  HARD no-auto-apply');
    lines.push(`  reason: ${proposal.hard_no_auto_apply_reason}`);
  }
  if (proposal.expiry_policy) {
    lines.push(`  expiry_policy: ${proposal.expiry_policy}`);
    lines.push(`  expires_at: ${proposal.expires_at}`);
  }

  lines.push(`  matched_span: ${proposal.originality.matched_span ?? 'none'}`);
  lines.push(`  originality_score: ${proposal.originality.score ?? 'none'}`);
  lines.push(`  diversity: ${proposal.diversity.blocked ? 'blocked' : 'pass'}`);
  lines.push(`  ${renderTrustPreview(proposal.trust_preview)}`);
  lines.push(renderEvidence(proposal.evidence).split('\n').map((line) => `  ${line}`).join('\n'));
  lines.push(renderScoreBlock('distribution', proposal.scores.distribution).split('\n').map((line) => `  ${line}`).join('\n'));
  lines.push(renderScoreBlock('engagement_quality', proposal.scores.engagement_quality).split('\n').map((line) => `  ${line}`).join('\n'));
  lines.push(renderScoreBlock('conversion_proxy', proposal.scores.conversion_proxy).split('\n').map((line) => `  ${line}`).join('\n'));
  return `${lines.join('\n')}\n`;
}
