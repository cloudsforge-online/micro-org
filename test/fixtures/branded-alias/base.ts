export type Network = 'mainnet' | 'testnet';

export interface ChainSpec {
  readonly asset: string;
  readonly explorerTxUrl: Readonly<Record<Network, string | null>>;
}
