// Every variable this service reads, declared in one place.
//
// WHY it is one place: rule 9 of docs/ecosystem/03 §2 — a repository declares the variables it
// needs and the deploy provides exactly those. `env_file: .env` fan-out, where every container
// receives every secret in the estate, is banned, and the only way a deploy can provide exactly
// what a service needs is if the service says so somewhere a person can read.
//
// __DB_ENV__ is the ONLY database this service may open. Rule 1: a service owns exactly one
// database and reads no other. service-ci.yml greps for any other connection string.

export interface Env {
  readonly port: number;
  readonly databaseUrl: string;
  readonly otlpEndpoint: string | undefined;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    // Fail closed and fail loudly at boot. A service that starts without its database and then
    // 500s every request is harder to diagnose than one that never started.
    throw new Error(`${name} is not set — __NAME__ cannot start without it`);
  }
  return value;
}

export function readEnv(): Env {
  return {
    port: Number.parseInt(process.env['PORT'] ?? '__PORT__', 10),
    databaseUrl: required('__DB_ENV__'),
    otlpEndpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'],
  };
}
