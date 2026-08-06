// `verifiedAt` widened to `string` so a citation can be corrected without a major version; `weight`
// widened to `number`. Every value that satisfied the old types still satisfies the new ones.
export const ROUTE: { readonly path: '/v1/tokens'; readonly verifiedAt: string; readonly weight: number } = {
  path: '/v1/tokens',
  verifiedAt: 'mint/src/server.ts',
  weight: 3,
};

export interface Spec {
  readonly kind: 'token';
  // NOT a widening: a different literal, which is what `type-changed` exists to catch.
  readonly retries: 5;
}
