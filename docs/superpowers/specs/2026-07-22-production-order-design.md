# Production Order and Printable A4 Design

**Date:** 2026-07-22
**Status:** Approved in conversation; awaiting written-spec review

## Objective

Add a shared, no-login production-order workflow to SOLE STOCK. Staff can create and print a production order, edit or cancel it while it is open, and manually receive the complete order into inventory exactly once.

The feature must work in the existing responsive Next.js application, use PostgreSQL/Supabase in production, retain demo-mode support, and preserve a durable relationship between the production order and the resulting stock receipt.

## Confirmed Decisions

- Production orders are persisted and have their own history.
- Receiving is manual; saving an order does not change inventory.
- An order is received in full, once. Partial or repeated receipts are not supported.
- Open orders can be edited or cancelled. Received and cancelled orders are immutable.
- Header fields are an automatic order number, order date, expected date, and note.
- Lines are entered manually by choosing model, color, size, and a positive integer quantity.
- Printing uses the browser print dialog, which also supports Save as PDF.
- The approved print layout is A4 portrait, one row per model/color/size line (visual option B).
- The system remains shared and open without application login or role checks.

## Scope

### Included

- Production-order navigation on desktop and mobile.
- List, search, status filters, create, detail, edit, cancel, print, and full receipt.
- Dedicated production-order persistence and Supabase RPCs.
- An atomic receipt that creates one existing-domain `RECEIPT` stock document.
- Thai validation, mutation, and retry messages.
- Responsive application UI and print-specific A4 styling.
- Demo repository behavior for local use and automated E2E coverage.

### Excluded

- Partial receipts or receiving an order across multiple dates.
- Automatic quantity suggestions based on low stock.
- Factory/supplier/contact management.
- Attachments, images, costs, prices, payments, or purchase accounting.
- A separately generated PDF file or server-side PDF storage.
- Authentication, approvals, or permission levels.
- Deleting audit records after an order has been saved.

## Domain Model

### Production order

A production order has:

- `id`: UUID primary key.
- `client_request_id`: unique UUID used to reconcile a create request after a lost response.
- `order_number`: unique automatic number such as `PO-20260722-000001`.
- `order_date`: date on which production was ordered.
- `expected_date`: requested receipt date; it cannot be before `order_date`.
- `note`: optional free text, stored as a non-null empty string when omitted.
- `status`: `OPEN`, `RECEIVED`, or `CANCELLED`.
- `received_document_id`: nullable unique reference to the stock receipt created by receiving.
- `created_at` and `updated_at`.
- `received_at` and `cancelled_at`, populated only for their terminal status.

### Production-order line

Each line has:

- `id`: UUID primary key.
- `order_id`: parent production order.
- `line_number`: stable display and print order within the document.
- `variant_id`: referenced product variant used when receiving stock.
- `model_name`, `color_name`, and `size`: immutable snapshots taken when the line is saved so old printed documents do not change after catalog renames.
- `quantity`: positive integer pair count.

An order cannot contain the same `variant_id` more than once. The UI may reorder lines before saving; persisted `line_number` values remain contiguous starting at one.

### Status transitions

```text
OPEN ── receive complete order ──> RECEIVED
  └──── cancel order ────────────> CANCELLED
```

`RECEIVED` and `CANCELLED` are terminal states. Cancelled orders remain visible for audit and printing but never affect inventory.

## Persistence and Server Contracts

Use dedicated `production_orders` and `production_order_lines` tables. Do not add a production-order movement type to the stock ledger: an open production order is a plan, not an inventory movement.

Use narrow `security definer` RPCs with direct table writes revoked from `public`, `anon`, and `authenticated`. RPC execution is granted to `anon` and `authenticated` to match the existing no-login application.

### Query contract

`get_production_orders()` returns a coherent JSON payload containing orders and their ordered lines. The client validates the entire response before mapping it into domain types.

### Save contract

`save_production_order(command jsonb)` handles creation and editing atomically.

- Create commands use a UUID `requestId` and return the same order when that request was already committed.
- Update commands include the `orderId`, lock that row, and reject changes unless status is `OPEN`.
- Both paths validate dates, non-empty lines, positive integer quantities, duplicate variants, and referenced active catalog variants.
- Model, color, and size snapshots are obtained in PostgreSQL from the referenced catalog records; client-provided display names are never trusted.
- Lines are replaced as one transaction during an edit, so a failed edit leaves the previous order unchanged.

### Cancellation contract

`cancel_production_order(command jsonb)` locks the order and changes `OPEN` to `CANCELLED`. Calling it again on a cancelled order is idempotent. Receiving or cancelling a received order is rejected.

### Receipt contract

`receive_production_order(command jsonb)` performs the complete receipt in one PostgreSQL transaction:

1. Validate `requestId`, `orderId`, and the receipt effective date.
2. Take an advisory request lock and a row lock on the production order.
3. If the order is already `RECEIVED`, return its linked stock document without posting again.
4. Reject a `CANCELLED` order.
5. Read all saved lines in deterministic `line_number` order.
6. Build a `RECEIPT` command using the production order number as `reference` and its line quantities.
7. Delegate inventory validation, balance locking, ledger creation, and balance updates to the existing `post_stock_document` RPC.
8. Set status to `RECEIVED`, store `received_document_id` and `received_at`, and return both the production order and stock document.

The receipt effective date is the user's local calendar date at the moment they confirm receipt. Version one does not expose a separate receipt-date picker.

This design prevents duplicate inventory receipts after double clicks, concurrent requests, a timeout, or a lost response. The production-order update and stock receipt commit or roll back together.

## Client Architecture

Keep production-order code separate from inventory-document forms:

- Production-order domain types and validation describe orders, lines, statuses, and commands.
- `ProductionOrderRepository` exposes load, save, cancel, and receive operations.
- `SupabaseProductionOrderRepository` uses the RPCs above and validates nested responses.
- `DemoProductionOrderRepository` persists orders locally, serializes mutations with a dedicated lock, and delegates a confirmed receipt to the demo inventory repository. Its status check prevents normal repeated receipt calls in demo mode.
- `ProductionOrderProvider` owns order loading, refresh-after-mutation, retained-data warnings, and Thai error mapping.

The production-order form reads the existing inventory catalog through `useInventory()` but does not read or change current balances while the user edits an order. A production quantity is a manual manufacturing request, not a computed replenishment amount.

## Routes and Navigation

Add a `ใบผลิตออเดอร์` item to desktop and horizontally scrollable mobile navigation.

- `/production-orders`: searchable and filterable list.
- `/production-orders/new`: create form.
- `/production-orders/[id]`: detail and action page.
- `/production-orders/[id]/edit`: edit an open order.
- `/production-orders/[id]/print`: dedicated print preview and browser print action.

The list shows order number, order date, expected date, line count, total pairs, and status. Search matches order number, snapshotted model name, and snapshotted color name. Status filtering supports all, open, received, and cancelled.

## Create and Edit Form

The header contains:

- Read-only automatic-number explanation on create; the number appears after save.
- Order date, defaulting to the user's local date.
- Expected date.
- Note.

The line editor uses the existing dependent selection pattern:

1. Model.
2. Color available for that model.
3. Existing size available for that model/color.
4. Positive integer quantity in pairs.

Users can add and remove lines. The form displays running line and pair totals. It rejects blank orders, duplicate variants, invalid quantities, and an expected date before the order date before contacting the repository.

Editing loads saved values and is only available while status is `OPEN`. Server-side status checks remain authoritative if another user receives or cancels the order while an edit screen is open.

## Detail and Actions

The detail page displays all header data, status, line table/cards, line count, total pairs, and any linked receipt number.

For `OPEN` orders it shows:

- `พิมพ์ใบผลิต`
- `แก้ไข`
- `ยกเลิกใบผลิต`
- `รับเข้าสต๊อก`

Cancellation uses SweetAlert2 and explains that the order will remain in history. Receipt uses a stronger SweetAlert2 confirmation showing the order number and total pairs. Both actions disable or guard repeat submission while pending.

For terminal orders, edit, cancel, and receive actions are absent. Printing remains available. A received order links to the resulting stock-history detail.

## Print Design

The approved design is visual option B: A4 portrait with one line per variant.

The printable document contains:

- SOLE STOCK heading and `ใบผลิตออเดอร์` title.
- Automatic production-order number.
- Order date and expected date.
- Status and total pair count.
- Columns for sequence, model/color, size, and quantity.
- Note when present.
- Signature lines for `ผู้สั่งผลิต` and `ผู้รับออเดอร์`.

Print rules:

- `@page { size: A4 portrait; margin: 12mm; }`.
- Hide application navigation, status badges not needed on paper, buttons, and browser-only helper copy.
- Print in high-contrast black/white while retaining restrained brand accents where supported.
- Repeat table headers on subsequent pages.
- Avoid breaking an individual row or signature block across pages.
- Preserve Kanit typography with sensible print fallbacks.
- Invoke `window.print()` only from the explicit print button; users can choose a printer or Save as PDF in the browser dialog.

## Error Handling

- Initial load failures show a Thai retry state.
- A failed save keeps entered form data intact.
- A server-side terminal-status conflict refreshes the order and explains that another user already received or cancelled it.
- A failed cancellation or receipt leaves the visible order unchanged and keeps the action available for retry.
- A committed receipt followed by a lost response is reconciled to the linked stock document and reported as successful, never posted twice.
- Print preview reports a missing or inaccessible order instead of rendering a blank page.

## Responsive Behavior

- Desktop uses the established table and page-header patterns.
- Mobile uses production-order cards and full-width primary actions with at least 44px touch targets.
- Line editing stacks dependent fields without horizontal overflow.
- The mobile navigation remains horizontally scrollable after adding the eighth item.
- Print layout is A4 and independent of the current screen viewport.

## Testing Strategy

### Unit and contract tests

- Production-order validation: dates, empty lines, duplicate variants, and quantities.
- Demo repository create, edit, cancel, terminal-state guards, and receipt behavior.
- Supabase repository RPC names, payloads, response mapping, idempotent request IDs, and Thai error mapping.
- Migration contract: tables, constraints, deterministic locks, delegation to `post_stock_document`, narrow grants, and no direct write grants.

### Component tests

- List search, status filters, totals, and empty/error states.
- Form dependent selections, duplicate prevention, retained values after failure, and edit restrictions.
- Detail actions by status.
- SweetAlert2 cancellation and receipt confirmation, loading guards, retry copy, and receipt result.
- Print page content and print button call.

### E2E tests

- Create a multi-line order from existing catalog variants.
- Edit and print the open order.
- Confirm print media hides navigation/actions and preserves required document content.
- Receive the whole order manually and verify inventory increases by exactly the line quantities.
- Verify stock history contains one `RECEIPT` whose reference is the production-order number.
- Verify the received order cannot be edited, cancelled, or received again.
- Create a second order, cancel it, and verify it never affects inventory.
- Run desktop and existing two mobile viewports without horizontal overflow.

## Acceptance Criteria

- Users can create, find, edit, cancel, view, and print production orders without login.
- The approved A4 portrait line-item layout prints complete order information through the browser dialog.
- Saving or printing never changes inventory.
- One explicit manual receipt adds every order line to stock and creates exactly one linked `RECEIPT` ledger document.
- Retrying, double-clicking, or concurrent receipt requests cannot add stock twice.
- Received and cancelled orders remain auditable and immutable.
- Existing inventory, receipt, issue, exchange, history, catalog, clear-stock, responsive, and Cloudflare build behaviors continue to pass.
