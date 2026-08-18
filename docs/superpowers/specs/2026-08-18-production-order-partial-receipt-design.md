# Production Order Partial Receipt

## Goal

Allow a production order to be received into stock incrementally, per line and across multiple receiving actions, while preserving the existing receive-all workflow.

## Approved behavior

- Each production-order line displays received quantity and remaining quantity.
- An open line exposes `รับเข้าแยก`. The action accepts one integer from 1 through the line's remaining quantity.
- A partial action creates one stock receipt document containing the selected line and quantity, referencing the production-order number.
- The action may be repeated until the line is complete. A completed line has no enabled partial-receive action.
- The page-level `รับเข้าสต็อก` action remains available while the order is open and receives the remaining quantity for every incomplete line in one stock document.
- The order remains `OPEN` while any line has remaining quantity and becomes `RECEIVED` only when all lines are complete.
- Cancelled and fully received orders do not expose receive actions.
- Demo and Supabase repositories expose identical behavior and validation.

## Data model

`ProductionOrderLine` gains `receivedQuantity`, defaulting to `0` for new and legacy open orders. The persisted Supabase line table gains `received_quantity integer not null default 0` with a constraint from `0` through `quantity`.

Because one order may have multiple receipt documents, add a private `production_order_receipts` relation keyed by order and stock document. It records each receipt document and its request identity. The existing single-document fields remain compatible for fully received legacy orders; new JSON includes the receipt document ids needed by the client without making historical documents ambiguous.

Editing an order remains limited to `OPEN` orders. Saving an open order must preserve the already received quantities and reject edits that reduce a line below its received quantity. New lines start at zero.

## Repository and RPC contract

Extend the repository with a receive command that accepts an order id, effective date, and optional line quantities. An omitted line selection means receive all remaining quantities. The result remains `{ order, document }` so the existing success flow remains compatible.

The Supabase `receive_production_order` RPC validates the request, locks the order, rejects cancelled orders and empty/over-limit selections, posts one atomic stock document for the selected remaining quantities, increments each line's received quantity, records the document relation, and transitions the order to `RECEIVED` only when all lines are complete. Request-id locking and retry reconciliation remain idempotent. Replaying a successful request returns its original document.

The demo repository mirrors these rules in its local snapshot and uses the same receipt-document shape.

## UI

The desktop table and mobile cards both show `รับแล้ว / จำนวน` and remaining quantity. Each line gets a partial-receive button. The existing action component owns the number-entry confirmation and loading/error behavior, while the detail page passes line context and renders the result. The page-level receive confirmation text changes to describe the remaining quantity after partial receipts.

## Validation and errors

- Reject zero, non-integer, non-numeric, and over-remaining quantities.
- Reject an empty partial command and any command for a non-open order.
- Never mutate stock or received quantities when validation fails.
- Preserve existing user-facing error mapping for not found, cancelled, already received, and invalid receipt errors.

## Testing

- Domain/repository tests cover initial zero received quantities, partial receipt, repeated partial receipt, completion, over-receipt rejection, all-remaining receipt after a partial receipt, cancellation, and idempotent retry.
- Component tests cover the per-line button, number input limits, success/error handling, disabled completed lines, and updated receive-all messaging.
- Migration tests assert the received-quantity constraint, receipt relation, RPC validation/locking, and grants.
- Run the focused tests, typecheck, lint, build, and the existing E2E suite before completion.

## Compatibility and rollout

The migration backfills `received_quantity` to `quantity` for existing `RECEIVED` orders and `0` for existing `OPEN` orders. Existing demo snapshots are normalized on load. No service-role key is exposed; browser access continues through the existing narrow RPCs.
