import assert from 'node:assert/strict';
import test from 'node:test';

import { createDashboardServer } from '../lib/dashboard-server.mjs';
import { readDecisionStore, withDashboardSandbox } from './fixtures/dashboard-state.mjs';

async function withServer(options, fn) {
  const server = createDashboardServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('T1 server serves dashboard and share routes with fixed viewport markers', async () => {
  await withDashboardSandbox(async ({ env, configPath }) => {
    await withServer({ env, configPath }, async (baseUrl) => {
      const html = await fetch(baseUrl).then((response) => {
        assert.equal(response.status, 200);
        return response.text();
      });
      for (const id of [
        'panel-trend',
        'panel-formula',
        'panel-trust',
        'panel-proposals',
        'panel-calibration',
        'panel-inspiration',
        'panel-evolution-log',
        'panel-share-link',
      ]) {
        assert.match(html, new RegExp(`id="${id}"`));
      }
      assert.match(html, /--vp-width:\s*1440px/);
      assert.match(html, /echarts\.min\.js/);

      const share = await fetch(`${baseUrl}/share`).then((response) => {
        assert.equal(response.status, 200);
        return response.text();
      });
      assert.match(share, /id="share-platform-card"/);
      assert.match(share, /id="share-overall-card"/);
      assert.match(share, /--vp-width:\s*1440px/);
    });
  });
});

test('T2 proposal POST records an audit decision and never applies', async () => {
  await withDashboardSandbox(async ({ root, env, configPath }) => {
    await withServer({ env, configPath }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/proposal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category: 'social-formula-facebook',
          decision: 'reject',
          source_proposal_id: 'prop-1',
        }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        applied: false,
        reason: 'propose-only-M1a',
      });

      const store = await readDecisionStore(root);
      assert.equal(store['social-formula-facebook'].rejected, 2);
      assert.equal(store['social-formula-facebook'].last_decision.decision, 'reject');
      assert.equal(store['social-formula-facebook'].last_decision.source_proposal_id, 'prop-1');

      const applyResponse = await fetch(`${baseUrl}/api/apply`, { method: 'POST' });
      assert.equal(applyResponse.status, 404);
    });
  });
});
