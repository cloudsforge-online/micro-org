// The topic-registry shape, exactly: a `keyof typeof` union — which typeToString EXPANDS inside
// a signature, unlike a hand-written alias — embedded in a function and in a type predicate.
// Every registered topic grows it, which is the additive change AD-02 exists to permit.
export const TOPICS = {
  'ledger.entry.posted': { keyedBy: 'account_id' },
  'wallet.deposit.confirmed': { keyedBy: 'wallet_id' },
} as const;

export type Topic = keyof typeof TOPICS;

export function isRegisteredTopic(topic: string): topic is Topic {
  return Object.hasOwn(TOPICS, topic);
}

export function describeTopic(topic: Topic): string {
  return topic;
}
