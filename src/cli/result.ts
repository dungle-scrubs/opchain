export type RuntimeResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly error: string; readonly ok: false };
