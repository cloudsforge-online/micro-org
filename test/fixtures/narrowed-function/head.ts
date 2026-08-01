export const TOPICS = {
  'ledger.entry.posted': { keyedBy: 'account_id' },
  'wallet.deposit.confirmed': { keyedBy: 'wallet_id' },
} as const;

export function describeTopic(topic: keyof typeof TOPICS): string {
  return topic;
}
