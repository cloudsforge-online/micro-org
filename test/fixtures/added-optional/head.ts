export interface Posting {
  account: string;
  amount: string;
  // Additive: nothing that constructed a Posting yesterday is wrong today.
  memo?: string;
}
