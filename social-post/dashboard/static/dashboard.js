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

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      node.dataset[key] = value == null ? '' : String(value);
    }
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

function emptyItem(message) {
  return element('div', { className: 'item', text: message });
}

function scorePill(name, score) {
  return element('span', { className: 'pill', text: `${name}: ${score?.value ?? '無資料'}` });
}

function renderProposals() {
  const host = document.querySelector('[data-list="proposals"]');
  if (!host) return;
  const items = (vm.proposals || []).map((proposal) => {
    const meta = `${proposal.hard_no_auto_apply ? '強制禁止自動套用 · ' : ''}${proposal.hard_no_auto_apply_reason || '已有轉換證據'}`;
    return element('article', { className: 'item' }, [
      element('div', { className: 'item-title', text: `${proposal.platform} · ${proposal.kind} · ${proposal.id}` }),
      element('div', { className: 'meta', text: meta }),
      element('div', { className: 'score-row' }, [
        scorePill('傳播', proposal.scores.distribution),
        scorePill('互動品質', proposal.scores.engagement_quality),
        scorePill('轉換代理', proposal.scores.conversion_proxy),
      ]),
      element('div', { className: 'actions' }, [
        element('button', { text: '採用', dataset: { decision: 'accept', category: proposal.category, id: proposal.id } }),
        element('button', { text: '駁回', dataset: { decision: 'reject', category: proposal.category, id: proposal.id } }),
        element('button', { text: '稍後', dataset: { decision: 'snooze', category: proposal.category, id: proposal.id } }),
      ]),
    ]);
  });
  host.replaceChildren(...(items.length ? items : [emptyItem('沒有待審提案。')]));
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
  const items = (vm.inspiration || []).map((item) =>
    element('article', { className: 'item' }, [
      element('div', { className: 'item-title', text: `${item.platform} · ${item.id}` }),
      element('p', { text: item.abstracted_template }),
      element('div', { className: 'meta', text: `原創性 ${item.originality_score ?? '無資料'} · 比對片段 ${item.matched_span || '無'}` }),
    ]),
  );
  host.replaceChildren(...(items.length ? items : [emptyItem('沒有外部靈感項目。')]));
}

function renderEvolution() {
  const host = document.querySelector('[data-list="evolution"]');
  if (!host) return;
  const items = (vm.evolutionLog || []).map((item) =>
    element('article', { className: 'item' }, [
      element('div', { className: 'item-title', text: item.category }),
      element('div', { className: 'meta', text: `${item.accepted} 已採用 · ${item.rejected} 已駁回 · ${item.snoozed} 已稍後` }),
    ]),
  );
  host.replaceChildren(...(items.length ? items : [emptyItem('尚無稽核決策。')]));
}

function metric(label, value) {
  return element('div', { className: 'metric' }, [
    element('strong', { text: value }),
    element('span', { text: label }),
  ]);
}

function renderShare() {
  if (!shareData) return;
  const overall = document.getElementById('share-overall-card');
  const platform = document.getElementById('share-platform-card');
  if (overall) {
    overall.replaceChildren(
      element('h2', { text: '整體每週卡片' }),
      element('div', { className: 'metric-grid' }, [
        metric('觸及', shareData.overall.weekly.reach),
        metric('互動', shareData.overall.weekly.engagement),
        metric('轉換代理', shareData.overall.weekly.conversion_proxy),
        metric('每次瀏覽', shareData.overall.weekly.per_view.toFixed(2)),
      ]),
    );
  }
  if (platform) {
    platform.replaceChildren(
      element('h2', { text: '各平台每週卡片' }),
      ...(shareData.perPlatform || []).map((card) =>
        element('article', { className: 'item' }, [
          element('div', { className: 'item-title', text: card.platform }),
          element('div', { className: 'score-row' }, [
            metric('觸及', card.weekly.reach),
            metric('互動', card.weekly.engagement),
            metric('轉換代理', card.weekly.conversion_proxy),
            metric('每次瀏覽', card.weekly.per_view.toFixed(2)),
          ]),
        ]),
      ),
    );
  }
}

renderCharts();
renderProposals();
bindProposalButtons();
renderInspiration();
renderEvolution();
renderShare();
