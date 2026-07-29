// A new chain family. Every value that was valid yesterday is still valid.
export type ChainFamily = 'evm' | 'ember' | 'solana';

export interface Address {
  family: ChainFamily;
  value: string;
}
