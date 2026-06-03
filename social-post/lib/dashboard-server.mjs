import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as digestAdapter from './adapters/digest-adapter.mjs';
import { buildShareCards, buildViewModel } from './dashboard-viewmodel.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(here);
const dashboardRoot = path.join(skillRoot, 'dashboard');
const staticTypes = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
});

function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

function json(res, status, body) {
  send(res, status, JSON.stringify(body), 'application/json; charset=utf-8');
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function assertProposalInput(body) {
  if (!/^social-(voice|formula|publish)-[a-z]+$/.test(body.category ?? '')) {
    throw new Error('unsupported category');
  }
  if (!['accept', 'reject', 'snooze'].includes(body.decision)) {
    throw new Error('unsupported decision');
  }
  if (typeof body.source_proposal_id !== 'string' || body.source_proposal_id.length === 0) {
    throw new Error('source_proposal_id required');
  }
}

async function renderTemplate(name, replacements) {
  let html = await readFile(path.join(dashboardRoot, 'templates', name), 'utf8');
  for (const [key, value] of Object.entries(replacements)) {
    html = html.replaceAll(`<!--${key}-->`, value);
  }
  return html;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://local');
  if (!url.pathname.startsWith('/static/')) return false;
  const name = path.basename(url.pathname);
  const ext = path.extname(name);
  const type = staticTypes[ext];
  if (!type) {
    send(res, 404, 'not found', 'text/plain; charset=utf-8');
    return true;
  }
  try {
    const body = await readFile(path.join(dashboardRoot, 'static', name), 'utf8');
    send(res, 200, body, type);
  } catch (error) {
    if (error.code === 'ENOENT') send(res, 404, 'not found', 'text/plain; charset=utf-8');
    else throw error;
  }
  return true;
}

export function createDashboardServer(options = {}) {
  const opts = { env: process.env, ...options };
  return http.createServer(async (req, res) => {
    try {
      if (await serveStatic(req, res)) return;
      const url = new URL(req.url, 'http://local');
      if (req.method === 'GET' && url.pathname === '/') {
        const vm = await buildViewModel(opts);
        send(res, 200, await renderTemplate('index.html', {
          VM_JSON: JSON.stringify(vm).replaceAll('<', '\\u003c'),
        }));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/share') {
        const vm = await buildViewModel(opts);
        const cards = buildShareCards(vm);
        send(res, 200, await renderTemplate('share.html', {
          VM_JSON: JSON.stringify(vm).replaceAll('<', '\\u003c'),
          SHARE_JSON: JSON.stringify(cards).replaceAll('<', '\\u003c'),
        }));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/view-model') {
        json(res, 200, await buildViewModel(opts));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/proposal') {
        const body = await readBody(req);
        assertProposalInput(body);
        const result = await digestAdapter.record(
          body.category,
          body.decision,
          { source_proposal_id: body.source_proposal_id },
          { env: opts.env },
        );
        json(res, 200, result);
        return;
      }
      send(res, 404, 'not found', 'text/plain; charset=utf-8');
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
}

export async function startDashboardServer(options = {}) {
  const port = Number(options.port ?? process.env.SOCIAL_DASHBOARD_PORT ?? 4177);
  const host = options.host ?? process.env.SOCIAL_DASHBOARD_HOST ?? '127.0.0.1';
  const server = createDashboardServer(options);
  await new Promise((resolve) => server.listen(port, host, resolve));
  return Object.freeze({ server, url: `http://${host}:${server.address().port}` });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startDashboardServer();
  process.stdout.write(`${url}\n`);
}
