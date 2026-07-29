// __NAME__ — a CloudsForge service.
//
// This skeleton exists so that standing a service up is an hour rather than a day, which is the
// third measured mitigation in docs/ecosystem/03 §5. It is deliberately dependency-free: the
// @cloudsforge/runtime packages replace most of what is below, and the import lines are marked
// so the swap is mechanical once those are published to GitHub Packages.
//
// The three endpoints are not decoration. Rule 4 of 03 §2: a service without /livez, /readyz and
// /metrics does not pass CI, because the gateway, the load balancer probe and Prometheus each
// need a different one and a service that conflates them cannot be drained safely.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readEnv } from './env.ts';

// swap for: import { livez, readyz } from '@cloudsforge/lifecycle';
// swap for: import { startTelemetry } from '@cloudsforge/telemetry';

interface Health {
  ready: boolean;
  reason: string;
}

const health: Health = { ready: false, reason: 'starting' };

const counters = {
  requests: 0,
  errors: 0,
};

// AD-17: SIGTERM flips ready to false, the service keeps serving for one load-balancer interval,
// then drains. A process that exits on SIGTERM drops the requests already in flight.
const DRAIN_MS = 5_000;

export function renderMetrics(): string {
  return [
    '# HELP __METRIC___requests_total Requests handled since start.',
    '# TYPE __METRIC___requests_total counter',
    `__METRIC___requests_total ${counters.requests}`,
    '# HELP __METRIC___errors_total Requests that returned 5xx.',
    '# TYPE __METRIC___errors_total counter',
    `__METRIC___errors_total ${counters.errors}`,
    '# HELP __METRIC___ready Whether the service is accepting traffic.',
    '# TYPE __METRIC___ready gauge',
    `__METRIC___ready ${health.ready ? 1 : 0}`,
    '',
  ].join('\n');
}

function handle(request: IncomingMessage, response: ServerResponse): void {
  counters.requests += 1;
  const url = request.url ?? '/';

  // Static. It answers whether the process is alive, nothing more: a livez that checks the
  // database restarts a healthy replica every time Postgres hiccups.
  if (url === '/livez') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"status":"ok"}');
    return;
  }

  // Checks the things a request needs. This is what depends_on and the load balancer read.
  if (url === '/readyz') {
    const code = health.ready ? 200 : 503;
    if (code === 503) counters.errors += 1;
    response.writeHead(code, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: health.ready ? 'ok' : 'not-ready', reason: health.reason }));
    return;
  }

  if (url === '/metrics') {
    response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
    response.end(renderMetrics());
    return;
  }

  counters.errors += 1;
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end('{"error":"not_found"}');
}

export async function start(): Promise<void> {
  const env = readEnv();
  const server = createServer(handle);

  await new Promise<void>((resolve) => server.listen(env.port, resolve));
  process.stdout.write(JSON.stringify({ level: 'info', msg: '__NAME__ listening', port: env.port }) + '\n');

  // Replace with a real dependency probe — the database, the JWKS endpoint, and every declared
  // upstream. Reporting ready before those answer is what makes a rolling deploy drop requests.
  health.ready = true;
  health.reason = 'ok';

  const shutdown = (): void => {
    health.ready = false;
    health.reason = 'draining';
    setTimeout(() => {
      server.close(() => process.exit(0));
    }, DRAIN_MS);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Background work goes in a leased job, never a timer. Rule 8 of 03 §2: `setInterval` doing
// domain work fails review, and service-ci.yml fails the build for it, because two replicas with
// the same timer do the same work twice and neither knows about the other.
//
//   import { defineJob } from '@cloudsforge/jobs';
//   defineJob({ name: '__NAME__.sweep', leaseKey: 'chain', handler: async () => { ... } });

// Only when this file is the entry point, so the tests can import the handlers without a socket
// being opened and an environment variable being demanded.
const entry = process.argv[1] ?? '';
if (entry.endsWith('index.ts') || entry.endsWith('index.js')) {
  await start();
}
