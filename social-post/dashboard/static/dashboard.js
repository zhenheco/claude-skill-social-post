const vm = JSON.parse(document.getElementById('vm')?.textContent || '{}');
const shareData = JSON.parse(document.getElementById('share-data')?.textContent || 'null');

const colors = ['#0b67ff', '#21b887', '#ffb020', '#e5484d', '#7b61ff'];

function chart(selector, option) {
  const el = document.querySelector(selector);
  if (!el || !globalThis.echarts) return;
  const instance = globalThis.echarts.init(el, null, { renderer: 'canvas' });
  instance.setOption({ color: colors, ...option });
}

function points() {
  return (vm.platforms || []).flatMap((platform) =>
    (platform.trend || []).map((point) => ({ ...point, platform: platform.platform })),
  );
}

function renderCharts() {
  const rows = points();
  chart('[data-chart="trend"]', {
    tooltip: {},
    legend: { top: 0 },
    xAxis: { type: 'category', data: rows.map((row) => `${row.platform}:${row.post_id}`) },
    yAxis: { type: 'value' },
    series: [
      { name: 'reach', type: 'line', data: rows.map((row) => row.reach) },
      { name: 'engagement', type: 'line', data: rows.map((row) => row.engagement) },
      { name: 'conversion proxy', type: 'line', data: rows.map((row) => row.conversion_proxy) },
      { name: 'per view', type: 'line', data: rows.map((row) => row.per_view) },
    ],
  });

  chart('[data-chart="formula"]', {
    tooltip: {},
    xAxis: { type: 'category', data: (vm.formulaLeaderboard || []).map((row) => `${row.platform}:${row.formula_id}`) },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: (vm.formulaLeaderboard || []).map((row) => row.conversion_proxy) }],
  });

  chart('[data-chart="trust"]', {
    tooltip: {},
    xAxis: { type: 'category', data: (vm.trust || []).map((row) => `${row.platform}:${row.dimension}`) },
    yAxis: { type: 'value', max: 1 },
    series: [{ type: 'bar', data: (vm.trust || []).map((row) => row.value ?? 0) }],
  });

  chart('[data-chart="calibration"]', {
    tooltip: {},
    legend: { top: 0 },
    xAxis: { type: 'category', data: (vm.calibration || []).map((row) => `${row.platform}:${row.bin}`) },
    yAxis: { type: 'value', max: 1 },
    series: [
      { name: 'predicted', type: 'bar', data: (vm.calibration || []).map((row) => row.predicted) },
      { name: 'observed', type: 'bar', data: (vm.calibration || []).map((row) => row.observed) },
    ],
  });
}

function scorePill(name, score) {
  return `<span class="pill">${name}: ${score?.value ?? 'absent'}</span>`;
}

function renderProposals() {
  const host = document.querySelector('[data-list="proposals"]');
  if (!host) return;
  host.innerHTML = (vm.proposals || []).map((proposal) => `
    <article class="item">
      <div class="item-title">${proposal.platform} · ${proposal.kind} · ${proposal.id}</div>
      <div class="meta">${proposal.hard_no_auto_apply ? 'HARD no-auto-apply · ' : ''}${proposal.hard_no_auto_apply_reason || 'conversion evidence present'}</div>
      <div class="score-row">
        ${scorePill('distribution', proposal.scores.distribution)}
        ${scorePill('engagement quality', proposal.scores.engagement_quality)}
        ${scorePill('conversion proxy', proposal.scores.conversion_proxy)}
      </div>
      <div class="actions">
        <button data-decision="accept" data-category="${proposal.category}" data-id="${proposal.id}">Accept</button>
        <button data-decision="reject" data-category="${proposal.category}" data-id="${proposal.id}">Reject</button>
        <button data-decision="snooze" data-category="${proposal.category}" data-id="${proposal.id}">Snooze</button>
      </div>
    </article>
  `).join('') || '<div class="item">No pending proposals.</div>';
}

function bindProposalButtons() {
  for (const button of document.querySelectorAll('[data-decision]')) {
    button.addEventListener('click', async () => {
      const response = await fetch('/api/proposal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category: button.dataset.category,
          decision: button.dataset.decision,
          source_proposal_id: button.dataset.id,
        }),
      });
      const result = await response.json();
      button.textContent = result.applied === false ? 'Recorded' : 'Error';
    });
  }
}

function renderInspiration() {
  const host = document.querySelector('[data-list="inspiration"]');
  if (!host) return;
  host.innerHTML = (vm.inspiration || []).map((item) => `
    <article class="item">
      <div class="item-title">${item.platform} · ${item.id}</div>
      <p>${item.abstracted_template}</p>
      <div class="meta">originality ${item.originality_score ?? 'n/a'} · matched span ${item.matched_span || 'none'}</div>
    </article>
  `).join('') || '<div class="item">No inspiration entries.</div>';
}

function renderEvolution() {
  const host = document.querySelector('[data-list="evolution"]');
  if (!host) return;
  host.innerHTML = (vm.evolutionLog || []).map((item) => `
    <article class="item">
      <div class="item-title">${item.category}</div>
      <div class="meta">${item.accepted} accepted · ${item.rejected} rejected · ${item.snoozed} snoozed</div>
    </article>
  `).join('') || '<div class="item">No audit decisions yet.</div>';
}

function metric(label, value) {
  return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`;
}

function renderShare() {
  if (!shareData) return;
  const overall = document.getElementById('share-overall-card');
  const platform = document.getElementById('share-platform-card');
  if (overall) {
    overall.innerHTML = `
      <h2>Overall weekly card</h2>
      <div class="metric-grid">
        ${metric('reach', shareData.overall.weekly.reach)}
        ${metric('engagement', shareData.overall.weekly.engagement)}
        ${metric('conversion proxy', shareData.overall.weekly.conversion_proxy)}
        ${metric('per view', shareData.overall.weekly.per_view.toFixed(2))}
      </div>
    `;
  }
  if (platform) {
    platform.innerHTML = `
      <h2>Per-platform weekly cards</h2>
      ${(shareData.perPlatform || []).map((card) => `
        <article class="item">
          <div class="item-title">${card.platform}</div>
          <div class="score-row">
            ${metric('reach', card.weekly.reach)}
            ${metric('engagement', card.weekly.engagement)}
            ${metric('conversion proxy', card.weekly.conversion_proxy)}
            ${metric('per view', card.weekly.per_view.toFixed(2))}
          </div>
        </article>
      `).join('')}
    `;
  }
}

renderCharts();
renderProposals();
bindProposalButtons();
renderInspiration();
renderEvolution();
renderShare();
