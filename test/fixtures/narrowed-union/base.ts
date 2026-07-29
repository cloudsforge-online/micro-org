export type WithdrawalState = 'pending' | 'signed' | 'broadcast' | 'stuck';

export interface Withdrawal {
  id: string;
  state: WithdrawalState;
}
