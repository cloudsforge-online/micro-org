export type ChainFamily = 'evm' | 'ember';

export interface Address {
  family: ChainFamily;
  value: string;
}
