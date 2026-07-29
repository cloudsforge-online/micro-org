import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudsforgeHosts } from './hosts.ts';

function at(href: string): Location {
  const url = new URL(href);
  return { protocol: url.protocol, hostname: url.hostname, port: url.port } as Location;
}

test('one bundle resolves different hosts per environment', () => {
  // The property web-ci.yml protects: the same artifact, promoted rather than rebuilt.
  assert.equal(cloudsforgeHosts(at('https://__NAME__.cloudsforge.online/')).identity, 'https://id.cloudsforge.online');
  assert.equal(cloudsforgeHosts(at('https://__NAME__.staging.cloudsforge.online/')).identity, 'https://id.staging.cloudsforge.online');
});

test('local development is named, not inferred', () => {
  assert.equal(cloudsforgeHosts(at('http://localhost:5173/')).identity, 'http://localhost:4100');
});
