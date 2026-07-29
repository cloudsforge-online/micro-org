import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMetrics } from './index.ts';

test('/metrics is Prometheus text format, so adopting a scraper costs a scrape config', () => {
  const body = renderMetrics();
  assert.match(body, /# TYPE __METRIC___requests_total counter/);
  assert.match(body, /__METRIC___ready [01]/);
  assert.ok(body.endsWith('\n'), 'the exposition format requires a trailing newline');
});
