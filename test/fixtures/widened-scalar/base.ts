// A citation swept into the public type by `as const`. It is provenance, not a contract: its whole
// value is being correct, which means being edited whenever the cited file is renamed or split.
export const ROUTE = {
  path: '/v1/tokens',
  verifiedAt: 'mint/src/server.ts',
  weight: 3,
} as const;

export interface Spec {
  readonly kind: 'token';
  readonly retries: 2;
}
