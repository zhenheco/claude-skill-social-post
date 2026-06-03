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
      { name: '觸及', type: 'line', data: rows.map((row) => row.reach) },
      { name: '互動', type: 'line', data: rows.map((row) => row.engagement) },
      { name: '轉換代理', type: 'line', data: rows.map((row) => row.conversion_proxy) },
      { name: '每次瀏覽', type: 'line', data: rows.map((row) => row.per_view) },
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
      { name: '預測', type: 'bar', data: (vm.calibration || []).map((row) => row.predicted) },
      { name: '實際', type: 'bar', data: (vm.calibration || []).map((row) => row.observed) },
    ],
  });
}

function scorePill(name, score) {
  return `<span class="pill">${name}: ${score?.value ?? '無資料'}</span>`;
}

function renderProposals() {
  const host = document.querySelector('[data-list="proposals"]');
  if (!host) return;
  host.innerHTML = (vm.proposals || []).map((proposal) => `
    <article class="item">
      <div class="item-title">${proposal.platform} · ${proposal.kind} · ${proposal.id}</div>
      <div class="meta">${proposal.hard_no_auto_apply ? '強制禁止自動套用 · ' : ''}${proposal.hard_no_auto_apply_reason || '已有轉換證據'}</div>
      <div class="score-row">
        ${scorePill('傳播', proposal.scores.distribution)}
        ${scorePill('互動品質', proposal.scores.engagement_quality)}
        ${scorePill('轉換代理', proposal.scores.conversion_proxy)}
      </div>
      <div class="actions">
        <button data-decision="accept" data-category="${proposal.category}" data-id="${proposal.id}">採用</button>
        <button data-decision="reject" data-category="${proposal.category}" data-id="${proposal.id}">駁回</button>
        <button data-decision="snooze" data-category="${proposal.category}" data-id="${proposal.id}">稍後</button>
      </div>
    </article>
  `).join('') || '<div class="item">沒有待審提案。</div>';
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
      button.textContent = result.applied === false ? '已記錄' : '錯誤';
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
      <div class="meta">原創性 ${item.originality_score ?? '無資料'} · 比對片段 ${item.matched_span || '無'}</div>
    </article>
  `).join('') || '<div class="item">沒有外部靈感項目。</div>';
}

function renderEvolution() {
  const host = document.querySelector('[data-list="evolution"]');
  if (!host) return;
  host.innerHTML = (vm.evolutionLog || []).map((item) => `
    <article class="item">
      <div class="item-title">${item.category}</div>
      <div class="meta">${item.accepted} 已採用 · ${item.rejected} 已駁回 · ${item.snoozed} 已稍後</div>
    </article>
  `).join('') || '<div class="item">尚無稽核決策。</div>';
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
      <h2>整體每週卡片</h2>
      <div class="metric-grid">
        ${metric('觸及', shareData.overall.weekly.reach)}
        ${metric('互動', shareData.overall.weekly.engagement)}
        ${metric('轉換代理', shareData.overall.weekly.conversion_proxy)}
        ${metric('每次瀏覽', shareData.overall.weekly.per_view.toFixed(2))}
      </div>
    `;
  }
  if (platform) {
    platform.innerHTML = `
      <h2>各平台每週卡片</h2>
      ${(shareData.perPlatform || []).map((card) => `
        <article class="item">
          <div class="item-title">${card.platform}</div>
          <div class="score-row">
            ${metric('觸及', card.weekly.reach)}
            ${metric('互動', card.weekly.engagement)}
            ${metric('轉換代理', card.weekly.conversion_proxy)}
            ${metric('每次瀏覽', card.weekly.per_view.toFixed(2))}
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
