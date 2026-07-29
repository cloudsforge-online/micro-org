export interface Quote {
  pair: string;
  // A field that was always present is now sometimes absent. Consumers wrote no undefined
  // handling because there was nothing to handle.
  price?: string;
}
