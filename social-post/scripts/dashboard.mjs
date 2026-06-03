#!/usr/bin/env node
import { startDashboardServer } from '../lib/dashboard-server.mjs';

const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const port = portArg ? Number(portArg.slice('--port='.length)) : undefined;
const { url } = await startDashboardServer({ port });

process.stdout.write(`social dashboard: ${url}\n`);
