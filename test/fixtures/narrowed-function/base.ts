// The other direction: a member REMOVED from a union inside a signature is a break — a caller
// passing the removed member no longer compiles — and must stay one. Same `keyof typeof` shape
// as widened-function, so the pair cannot go stale separately.
export const TOPICS = {
  'ledger.entry.posted': { keyedBy: 'account_id' },
  'wallet.deposit.confirmed': { keyedBy: 'wallet_id' },
  'mint.deploy.confirmed': { keyedBy: 'token_id' },
} as const;

export function describeTopic(topic: keyof typeof TOPICS): string {
  return topic;
}
