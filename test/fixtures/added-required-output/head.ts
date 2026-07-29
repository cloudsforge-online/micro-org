export interface Balance {
  account: string;
  amount: string;
  // Additive: a consumer reads a Balance, it never builds one, so a new guaranteed field is a
  // gift rather than a demand. This is the pair that proves the input/output split is real.
  asOf: string;
}
