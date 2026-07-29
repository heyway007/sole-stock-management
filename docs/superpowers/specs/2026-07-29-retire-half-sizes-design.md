# Retire Legacy Half Sizes Design

## Goal

Remove the legacy shoe-size labels `38.5` and `43.5` from inventory and all
new operational selections while preserving stock-document and
production-order history.

## Current Production Evidence

- The original numeric-size seed introduced only two half-size labels:
  `38.5` and `43.5`.
- Production currently contains 19 variants with those labels. All 19 are
  active and have zero on-hand stock.
- Two historical stock-document lines reference those variants.
- No production-order line currently references either retired label.
- Foot-length copy such as `24–24.5 cm` is descriptive text and is outside
  this change.

## Design

The exact canonical labels `38.5` and `43.5` are retired. Other custom size
labels, including labels such as `44.5`, keep their existing behavior.

The client retains retired variants in the snapshot so history can still
resolve their model, color, and size. When a Supabase snapshot marks either
retired label active, the client treats it as inactive. Existing operational
screens already exclude inactive variants, so the labels disappear from the
inventory page, receiving, issuing, exchanges, and production-order
selection without weakening history.

Both demo and Supabase repositories reject attempts to create or reactivate
a retired label. This prevents the "add new size" flow from bringing the
labels back before or after the database migration.

A forward-only migration sets every matching product variant inactive and
adds a database constraint that prevents either label from being active.
The migration must not delete product variants, balances, stock documents,
stock-document lines, production orders, or production-order lines.

## Error Handling

Attempts to add `38.5` or `43.5` return a Thai validation error stating that
the selected size is no longer available. Invalid labels continue to use the
existing required-size error.

## Verification

- Unit tests cover exact retired-label detection and confirm nearby labels
  remain allowed.
- Supabase mapping tests confirm the variant remains present but becomes
  inactive.
- Demo and Supabase repository tests confirm retired sizes are rejected
  before mutation or RPC calls.
- Migration contract tests confirm deactivation, the active-state
  constraint, and the absence of destructive deletes.
- The full unit suite, typecheck, lint, production build, Cloudflare build,
  and deployed pages are verified before completion.
