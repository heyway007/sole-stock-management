# Production Order Discount Field Design

## Goal

Add an order-level `ส่วนลด (บาท)` field to the production-order create and
edit forms. The value is stored with the order and restored when the order is
edited.

The discount is informational only. It does not change line totals, the form
summary, the order total, inventory receipt behavior, the detail page, or the
print layout.

## Data Model

`ProductionOrderInput` and `ProductionOrder` gain a `discount` number in baht.
New orders default to `0`. Valid values are finite numbers from `0` upward with
at most two decimal places.

The demo repository persists the value in its existing local state. Its
compatibility projection maps legacy orders without a discount to `0`.

A forward-only Supabase migration adds
`production_orders.discount numeric(14,2) not null default 0` with a
non-negative check. The production-order JSON and save RPCs include the new
field. Existing rows therefore remain valid with a zero discount.

The Supabase client mapper also treats an omitted discount as `0` so the new
frontend can still load orders while a deployment is transitioning between
the old and new RPC versions.

The save RPC remains compatible with clients opened before the deployment.
When such a client omits `discount`, creates default to `0` and edits preserve
the order's current discount. A present discount still receives full numeric
and precision validation.

## Form Behavior

The create and edit forms show a numeric field labeled `ส่วนลด (บาท)` in the
order metadata section.

- Create starts at `0`.
- Edit starts with the order's saved value.
- Empty input is interpreted as `0`.
- Negative values, non-numeric values, and values with more than two decimal
  places are rejected inline.
- Saving sends the normalized numeric value to the repository.
- The existing amount summary continues to show the unchanged sum of line
  totals.

No discount value is added to the order list, detail page, or print view.

## Error Handling

Domain validation reports an `INVALID_DISCOUNT` error at `discount` when the
value is invalid. Repository validation uses the same rule before local
mutation or Supabase RPC execution. Database constraints provide the final
write boundary for Supabase.

## Verification

- Domain tests cover zero, positive values, two-decimal precision, negative
  values, and excessive precision.
- Form tests confirm create submission, edit initialization, and unchanged
  displayed totals.
- Demo repository tests confirm persistence and legacy defaulting.
- Supabase repository tests confirm command serialization and legacy response
  compatibility.
- Migration contract tests confirm the column, constraint, JSON output, and
  save behavior.
- The complete unit suite, typecheck, lint, production build, local browser
  flow, deployment build, and live production flow are verified before the
  work is considered complete.
