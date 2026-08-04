export type Network = 'mainnet' | 'testnet';

declare const explorerTable: unique symbol;

/**
 * The same record as `base.ts`, branded so only a sanctioned factory can build one. A reader sees
 * an identical type: `.mainnet` and `.testnet` are still `string | null`.
 */
export type ExplorerTxUrls = Readonly<Record<Network, string | null>> & {
  readonly [explorerTable]: true;
};

export interface ChainSpec {
  readonly asset: string;
  readonly explorerTxUrl: ExplorerTxUrls;
}
