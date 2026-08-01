// A topic was registered. Every call that compiled still compiles; every read still compiles.
export const TOPICS = {
  'ledger.entry.posted': { keyedBy: 'account_id' },
  'wallet.deposit.confirmed': { keyedBy: 'wallet_id' },
  'aetherholm.city.founded': { keyedBy: 'city_id' },
} as const;

export type Topic = keyof typeof TOPICS;

export function isRegisteredTopic(topic: string): topic is Topic {
  return Object.hasOwn(TOPICS, topic);
}

export function describeTopic(topic: Topic): string {
  return topic;
}
