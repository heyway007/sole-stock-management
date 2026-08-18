# Production Order Partial Receipt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each production-order line be received into stock in multiple partial actions, while retaining a receive-all action for all remaining quantities.

**Architecture:** Extend the production-order line model with `receivedQuantity`, and extend the repository receive command with optional selected line quantities. The demo repository and a new Supabase migration/RPC implementation share the same atomic rules: post one receipt document, increment selected lines, and mark an order `RECEIVED` only when all lines are complete. The detail page renders per-line progress and uses the existing SweetAlert confirmation pattern for quantity entry.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest + Testing Library, Supabase RPC/PostgreSQL migrations, SweetAlert2.

**Spec:** `docs/superpowers/specs/2026-08-18-production-order-partial-receipt-design.md`

## Global Constraints

- A partial action accepts an integer from 1 through the selected line's remaining quantity.
- The page-level receive action receives only remaining quantities for incomplete lines.
- An order stays `OPEN` until every line is complete and becomes `RECEIVED` only when all lines are complete.
- Demo and Supabase repositories expose identical behavior and validation.
- Existing legacy received orders remain readable; their existing single receipt reference continues to work.
- Browser access continues through the existing narrow RPCs; no service-role key is added.
- Preserve unrelated working-tree changes in `next-env.d.ts` and `.worktrees/`.

---

## File map

- Modify `src/features/production-orders/domain/types.ts`: add received-quantity and receipt-command types.
- Modify `src/features/production-orders/data/production-order-repository.ts`: expose the optional line-selection receive contract.
- Modify `src/features/production-orders/data/demo-production-order-repository.ts`: normalize old snapshots and implement repeatable partial receipts.
- Modify `src/features/production-orders/data/supabase-production-order-repository.ts`: map the new fields and send selected line quantities with stable idempotency keys.
- Modify `src/features/production-orders/production-order-provider.tsx`: accept the new receive input and refresh inventory after every receipt.
- Modify `src/features/production-orders/components/production-order-actions.tsx`: show the line-level quantity dialog and receive-all remaining text.
- Modify `src/app/production-orders/[id]/page.tsx`: render line progress and pass line context to the actions component.
- Modify `src/app/globals.css`: fit progress/action controls into desktop rows and mobile cards.
- Modify `src/lib/supabase.ts`: add the new JSON fields and RPC command types to the typed Supabase client.
- Create `supabase/migrations/202608180008_partial_production_order_receipts.sql`: add persisted received quantities, receipt relations, compatibility backfill, updated JSON/RPCs, and grants.
- Modify `tests/unit/production-order-domain.test.ts`: test received-quantity domain invariants if a pure helper is introduced.
- Modify `tests/unit/demo-production-order-repository.test.ts`: test partial, repeated, complete, over-limit, all-remaining, and idempotent behavior.
- Modify `tests/unit/supabase-production-order-repository.test.ts`: test command payloads, mapping, and retry-key separation.
- Modify `tests/unit/supabase-migration.test.ts`: assert the new schema, backfill, locking, validation, and grants.
- Modify `tests/components/production-order-actions.test.tsx`: test quantity entry, limits, success/error, and receive-all remaining messaging.
- Modify `tests/components/production-order-detail.test.tsx`: test progress and per-line action rendering.

## Data contract used by all tasks

Add these types in `src/features/production-orders/domain/types.ts`:

```ts
export interface ProductionOrderReceiptLineInput {
  lineId: string;
  quantity: number;
}

export interface ProductionOrderReceiptInput {
  orderId: string;
  effectiveDate: string;
  lines?: ProductionOrderReceiptLineInput[];
}
```

Add `receivedQuantity: number` to `ProductionOrderLine` and `receiptDocumentIds: string[]` to `ProductionOrder`. Keep `receivedDocumentId: string | null` for compatibility; it represents the latest receipt document and remains populated for fully received legacy orders.

Change the repository method to:

```ts
receive(input: ProductionOrderReceiptInput): Promise<ProductionOrderReceiptResult>;
```

When `lines` is omitted, the command means all remaining lines. When `lines` is present, it must contain at least one unique line id and positive integer quantities.

---

### Task 1: Lock the domain and repository contract with failing tests

**Files:**
- Modify: `src/features/production-orders/domain/types.ts`
- Modify: `src/features/production-orders/data/production-order-repository.ts`
- Modify: `tests/unit/production-order-domain.test.ts`
- Modify: `tests/unit/demo-production-order-repository.test.ts`

**Interfaces:**
- Consumes: Existing `ProductionOrder`, `ProductionOrderLine`, and `ProductionOrderReceiptResult` types.
- Produces: `ProductionOrderReceiptLineInput`, `ProductionOrderReceiptInput`, `receivedQuantity`, `receiptDocumentIds`, and the new `receive(input)` method signature for later tasks.

- [ ] **Step 1: Add contract assertions before implementation**

Add tests that construct an open order with `receivedQuantity: 0` on every line and assert that the receipt input shape accepts both `{ orderId, effectiveDate }` and `{ orderId, effectiveDate, lines: [{ lineId, quantity }] }`. Add a test fixture assertion that a line's remaining amount is `quantity - receivedQuantity` and never negative.

- [ ] **Step 2: Run the focused tests to capture the expected type/behavior failures**

Run:

```powershell
npm test -- tests/unit/production-order-domain.test.ts tests/unit/demo-production-order-repository.test.ts
```

Expected: FAIL because the new fields and input contract are not present yet.

- [ ] **Step 3: Implement the shared types and interface only**

Add the types shown in the data contract, add `receivedQuantity` and `receiptDocumentIds`, and replace the repository signature. Do not change repository behavior in this task.

- [ ] **Step 4: Run typecheck to enumerate all call sites that must be updated**

Run:

```powershell
npm run typecheck
```

Expected: FAIL only at existing repository implementations, providers, actions, and test doubles that still use the old signature; record those locations for Tasks 2–5.

- [ ] **Step 5: Commit the contract change**

```powershell
git add src/features/production-orders/domain/types.ts src/features/production-orders/data/production-order-repository.ts tests/unit/production-order-domain.test.ts tests/unit/demo-production-order-repository.test.ts
git commit -m "feat: define partial production receipt contract"
```

### Task 2: Implement repeatable partial receipts in the demo repository

**Files:**
- Modify: `src/features/production-orders/data/demo-production-order-repository.ts`
- Modify: `tests/unit/demo-production-order-repository.test.ts`

**Interfaces:**
- Consumes: `ProductionOrderReceiptInput` and the updated repository interface from Task 1.
- Produces: Demo behavior that normalizes old snapshots, creates one stock document per command, increments selected line quantities, and returns `OPEN` or `RECEIVED` correctly.

- [ ] **Step 1: Write failing repository tests for partial behavior**

Add tests with a two-line order of quantities 4 and 6:

```ts
const partial = await repository.receive({
  orderId: order.id,
  effectiveDate: "2026-08-18",
  lines: [{ lineId: "line-1", quantity: 2 }],
});
expect(partial.order.status).toBe("OPEN");
expect(partial.order.lines[0].receivedQuantity).toBe(2);
expect(partial.document.lines).toEqual([{ id: expect.any(String), variantId: "variant-1", delta: 2 }]);
```

Also test a second partial receipt, a final receipt that changes status to `RECEIVED`, a page-level receive that consumes all remaining lines, zero/decimal/over-limit rejection without state mutation, cancelled-order rejection, and two concurrent different commands not sharing one in-flight request.

- [ ] **Step 2: Run the demo repository tests and verify they fail**

Run:

```powershell
npm test -- tests/unit/demo-production-order-repository.test.ts
```

Expected: FAIL because stored lines have no received quantity and the method accepts the old arguments.

- [ ] **Step 3: Normalize snapshot state at the repository boundary**

When loading state, map missing `receivedQuantity` to `quantity` for `RECEIVED` orders and to `0` for `OPEN` orders. Map missing `receiptDocumentIds` to `[receivedDocumentId]` when the legacy id exists, otherwise `[]`. Keep the normalized shape in the persisted demo snapshot so later calls see the same state.

- [ ] **Step 4: Implement the demo receive command**

Build the selected lines as follows:

```ts
const selected = input.lines?.length
  ? input.lines
  : order.lines
      .filter((line) => line.receivedQuantity < line.quantity)
      .map((line) => ({ lineId: line.id, quantity: line.quantity - line.receivedQuantity }));
```

Validate each line id, uniqueness, positive integer quantity, and `quantity <= line.quantity - line.receivedQuantity`. Post one `RECEIPT` document using the selected quantities, increment the lines, append the document id to `receiptDocumentIds`, set `receivedDocumentId` to the new document id, and set status to `RECEIVED` only when every line is complete. Use a request key derived from the order id and canonical selected lines so different partial commands cannot be incorrectly coalesced.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```powershell
npm test -- tests/unit/demo-production-order-repository.test.ts
npm run typecheck
```

Expected: PASS for the focused tests and no remaining demo-repository type errors.

- [ ] **Step 6: Commit the demo implementation**

```powershell
git add src/features/production-orders/data/demo-production-order-repository.ts tests/unit/demo-production-order-repository.test.ts
git commit -m "feat: support partial production receipts in demo mode"
```

### Task 3: Add the Supabase schema and RPC implementation

**Files:**
- Create: `supabase/migrations/202608180008_partial_production_order_receipts.sql`
- Modify: `src/lib/supabase.ts`
- Modify: `src/features/production-orders/data/supabase-production-order-repository.ts`
- Modify: `tests/unit/supabase-production-order-repository.test.ts`
- Modify: `tests/unit/supabase-migration.test.ts`

**Interfaces:**
- Consumes: The shared receipt input from Task 1.
- Produces: A Supabase RPC accepting `{ requestId, orderId, effectiveDate, lines? }`, returning mapped received quantities and receipt document ids.

- [ ] **Step 1: Add failing migration assertions**

Assert that the migration contains:

```ts
expect(migration).toContain("received_quantity integer not null default 0");
expect(migration).toContain("create table public.production_order_receipts");
expect(migration).toContain("create or replace function public.receive_production_order(command jsonb)");
expect(migration).toContain("for update of production_order");
expect(migration).toContain("grant execute on function public.receive_production_order(jsonb) to anon, authenticated;");
```

Add assertions for the backfill of completed legacy orders, the `0 <= received_quantity <= quantity` check, selected-line validation, receipt relation insertion, and the all-lines-complete status transition.

- [ ] **Step 2: Add failing repository RPC payload tests**

Update the fake client tests to call:

```ts
await repository.receive({
  orderId: "order-1",
  effectiveDate: "2026-08-18",
  lines: [{ lineId: "line-1", quantity: 3 }],
});
```

Assert that `rpc("receive_production_order", { command: { requestId: expect.any(String), orderId: "order-1", effectiveDate: "2026-08-18", lines: [{ lineId: "line-1", quantity: 3 }] } })` is sent. Add a separate test proving a command for line 2 does not reuse the pending request identity for line 1.

- [ ] **Step 3: Add the migration schema and compatibility backfill**

Create `production_order_receipts` with `id`, `order_id`, `document_id`, `client_request_id`, and `created_at`; enforce unique `document_id` and `client_request_id`; add indexes needed by order lookup. Add `received_quantity integer not null default 0` to `production_order_lines` with a check bounded by `quantity`. Backfill received quantities and receipt relations from existing `production_orders.received_document_id` and `stock_documents.client_request_id`.

- [ ] **Step 4: Recreate the production-order JSON function with progress fields**

Return `receivedQuantity` on every line and `receiptDocumentIds` from the receipt relation ordered by creation time. Preserve `receivedDocumentId` as the latest/legacy document id, and preserve pricing fields introduced by the current latest migration.

- [ ] **Step 5: Update save validation for already received quantities**

When editing an open order, lock and retain the existing line received quantities by variant id before deleting/reinserting lines. Reject a replacement quantity below the retained received quantity with a stable `PRODUCTION_ORDER_RECEIVED_QUANTITY_EXCEEDS_NEW_QUANTITY` error. Insert retained values for existing variants and `0` for new variants. Do not allow edits to received or cancelled orders.

- [ ] **Step 6: Update the receive RPC atomically**

Lock the order and acquire the existing request-id advisory lock. If the request already has a relation, replay the original stock document. Otherwise, derive all remaining lines when `lines` is absent; when present, validate line ids, uniqueness, positive integer quantities, and remaining limits. Build one `RECEIPT` command with only selected quantities, call `post_stock_document`, increment the selected production lines, insert the order/document relation, set `received_document_id` to the new document, and set `status = 'RECEIVED'` only when no line has remaining quantity. Return the updated order and posted document in the existing result shape.

- [ ] **Step 7: Update typed client and repository mapping**

Add `receivedQuantity` and `receiptDocumentIds` to the mapped production-order shape, add the new RPC command argument types in `src/lib/supabase.ts`, accept `ProductionOrderReceiptInput`, and use a canonical request key such as `receive:${orderId}:${JSON.stringify(sortedLines ?? null)}`.

- [ ] **Step 8: Run focused Supabase tests**

Run:

```powershell
npm test -- tests/unit/supabase-production-order-repository.test.ts tests/unit/supabase-migration.test.ts
npm run typecheck
```

Expected: PASS with the new payload/mapping/migration assertions and no type errors.

- [ ] **Step 9: Commit the Supabase implementation**

```powershell
git add supabase/migrations/202608180008_partial_production_order_receipts.sql src/lib/supabase.ts src/features/production-orders/data/supabase-production-order-repository.ts tests/unit/supabase-production-order-repository.test.ts tests/unit/supabase-migration.test.ts
git commit -m "feat: persist partial production receipts in Supabase"
```

### Task 4: Thread the receipt input through providers and existing action flow

**Files:**
- Modify: `src/features/production-orders/production-order-provider.tsx`
- Modify: `src/features/production-orders/data/production-order-repository.ts`
- Modify: `tests/components/production-order-provider.test.tsx`
- Modify: `tests/components/production-order-actions.test.tsx`

**Interfaces:**
- Consumes: `ProductionOrderReceiptInput` and repository implementations from Tasks 2–3.
- Produces: `useProductionOrders().receive(input)` that refreshes both production orders and inventory after every receipt.

- [ ] **Step 1: Update provider tests first**

Change the fake repository to record the full input and assert that the provider passes `{ orderId: "order-1", effectiveDate: "2026-08-18", lines: [{ lineId: "line-1", quantity: 2 }] }`. Assert that `inventory.refresh()` is still called after a partial receipt and after a receive-all command.

- [ ] **Step 2: Run the provider tests to verify the old signature fails**

Run:

```powershell
npm test -- tests/components/production-order-provider.test.tsx
```

Expected: FAIL at the old `receive(orderId, effectiveDate)` calls.

- [ ] **Step 3: Change the provider context and callback**

Expose `receive(input: ProductionOrderReceiptInput)` and pass the same object to the selected repository. Keep the existing `runMutation` refresh behavior and call `inventory.refresh()` after the repository result resolves.

- [ ] **Step 4: Update the existing all-receive action test**

Assert that the action calls `onReceive({ orderId: "order-1", effectiveDate: expect.any(String) })`, and that the confirmation text says it receives the remaining quantity rather than always claiming the original total.

- [ ] **Step 5: Run focused tests and commit**

```powershell
npm test -- tests/components/production-order-provider.test.tsx tests/components/production-order-actions.test.tsx
npm run typecheck
git add src/features/production-orders/production-order-provider.tsx src/features/production-orders/data/production-order-repository.ts tests/components/production-order-provider.test.tsx tests/components/production-order-actions.test.tsx
git commit -m "refactor: pass partial receipt commands through providers"
```

### Task 5: Add the per-line receive UI

**Files:**
- Modify: `src/features/production-orders/components/production-order-actions.tsx`
- Modify: `src/app/production-orders/[id]/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/components/production-order-actions.test.tsx`
- Modify: `tests/components/production-order-detail.test.tsx`

**Interfaces:**
- Consumes: `ProductionOrderReceiptInput`, `ProductionOrderLine.receivedQuantity`, and provider `receive(input)` from Task 4.
- Produces: Per-line `รับเข้าแยก` controls with bounded number entry, progress display, disabled completed lines, and unchanged receive-all behavior.

- [ ] **Step 1: Write failing component tests for the per-line flow**

Add tests that render an open two-line order and assert:

```ts
expect(screen.getByText("รับแล้ว 0 / 4 คู่")).toBeInTheDocument();
expect(screen.getAllByRole("button", { name: "รับเข้าแยก" })).toHaveLength(2);
```

Mock SweetAlert to return `2` from the number-entry dialog, then assert `onReceive` receives `{ orderId: "order-1", effectiveDate: expect.any(String), lines: [{ lineId: "line-1", quantity: 2 }] }`. Add tests for max remaining input, success document messaging, validation failure, and a line with `receivedQuantity === quantity` having no enabled partial button.

- [ ] **Step 2: Run the component tests and verify they fail**

Run:

```powershell
npm test -- tests/components/production-order-actions.test.tsx tests/components/production-order-detail.test.tsx
```

Expected: FAIL because the detail page has no progress text or per-line controls.

- [ ] **Step 3: Implement the line-level confirmation dialog**

Add `onReceivePartial(line)` to the actions component. Use SweetAlert2 with `input: "number"`, `inputValue: remaining`, `inputAttributes: { min: "1", max: String(remaining), step: "1" }`, and a `preConfirm` validator that returns a positive integer no greater than remaining. Call `onReceive({ orderId: order.id, effectiveDate: localDateValue(), lines: [{ lineId: line.id, quantity }] })`, preserve loading guards, and show the returned document number on success.

- [ ] **Step 4: Keep the page-level receive-all action correct after partials**

Compute remaining pairs as the sum of `line.quantity - line.receivedQuantity`, use it in the confirmation text, and call `onReceive({ orderId: order.id, effectiveDate: localDateValue() })`. Hide the action when the order is not open or no remaining quantity exists.

- [ ] **Step 5: Render progress and controls in both layouts**

In the desktop table, add a received/progress cell and an action cell after the product fields. In mobile cards, show the same progress text and place the button after the product summary. Use the existing `Button` styling and add only focused CSS for wrapping and minimum touch target size.

- [ ] **Step 6: Run focused UI tests and commit**

```powershell
npm test -- tests/components/production-order-actions.test.tsx tests/components/production-order-detail.test.tsx
npm run typecheck
git add src/features/production-orders/components/production-order-actions.tsx src/app/production-orders/[id]/page.tsx src/app/globals.css tests/components/production-order-actions.test.tsx tests/components/production-order-detail.test.tsx
git commit -m "feat: add per-line production receipt controls"
```

### Task 6: Normalize legacy data and complete verification

**Files:**
- Modify: `src/features/production-orders/data/demo-production-order-repository.ts` if any legacy normalization test remains uncovered.
- Modify: `tests/unit/demo-production-order-repository.test.ts` for old snapshot compatibility.
- Modify: `tests/components/production-order-detail.test.tsx` for legacy received orders.

**Interfaces:**
- Consumes: All completed implementation tasks.
- Produces: Verified compatibility and a clean handoff with no changes to unrelated files.

- [ ] **Step 1: Add legacy compatibility tests**

Load a demo snapshot with an old `RECEIVED` order missing `receivedQuantity` and `receiptDocumentIds`; assert it normalizes to each line's full quantity and the legacy document id. Render a legacy received order and assert no receive buttons appear.

- [ ] **Step 2: Run the full unit/component suite**

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 3: Run static checks**

```powershell
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit successfully.

- [ ] **Step 4: Run the existing E2E suite**

```powershell
npm run e2e
```

Expected: existing demo-mode inventory smoke tests pass; no production-order receive regression is introduced.

- [ ] **Step 5: Inspect the final diff and status**

```powershell
git diff --check HEAD~6..HEAD
git status --short --branch
```

Confirm that only the planned files plus the pre-existing `next-env.d.ts` and `.worktrees/` entries are present.

- [ ] **Step 6: Commit any final test-only compatibility adjustments**

```powershell
git add tests/unit/demo-production-order-repository.test.ts tests/components/production-order-detail.test.tsx
git commit -m "test: verify legacy production receipt compatibility"
```

## Self-review checklist

- [x] Spec coverage: UI, domain contract, demo persistence, Supabase schema/RPC, compatibility, errors, idempotency, and tests each map to a task.
- [x] Placeholder scan: no incomplete placeholders or vague implementation instructions are used.
- [x] Type consistency: all tasks use `ProductionOrderReceiptInput`, `ProductionOrderReceiptLineInput`, `receivedQuantity`, and `receiptDocumentIds` consistently.
- [x] Unrelated changes: `next-env.d.ts` and `.worktrees/` are explicitly excluded from implementation commits.
