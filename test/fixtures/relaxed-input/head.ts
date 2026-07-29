export interface CreateWalletRequest {
  chain: string;
  // Making an input optional relaxes what a caller must supply. Every existing call still
  // compiles, so this is additive — the mirror image of weakened-guarantee on an output.
  label?: string;
}
