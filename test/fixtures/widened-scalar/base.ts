// A citation swept into the public type by `as const`. It is provenance, not a contract: the whole
// value of a `path:line` is being correct, which means being edited whenever the cited file moves.
export const ROUTE = {
  path: '/v1/tokens',
  verifiedAt: 'mint/src/server.ts:359',
  weight: 3,
} as const;

export interface Spec {
  readonly kind: 'token';
  readonly retries: 2;
}
