// 'stuck' withdrawn from the union. Every consumer with a case for it now has dead code, and
// every consumer that persisted the value can no longer parse its own rows.
export type WithdrawalState = 'pending' | 'signed' | 'broadcast';

export interface Withdrawal {
  id: string;
  state: WithdrawalState;
}
