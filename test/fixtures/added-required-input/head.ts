export interface PostEntryRequest {
  idempotencyKey: string;
  reference: string;
  // Breaking: the name ends 'Request', so every caller constructs one, and every caller is now
  // missing a required field.
  actor: string;
}
