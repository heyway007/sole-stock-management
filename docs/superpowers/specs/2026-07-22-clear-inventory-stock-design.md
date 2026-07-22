# Clear Inventory Stock Design

## Goal

Add a deliberately guarded action that sets every on-hand inventory balance to zero while preserving the shoe catalog and a complete audit trail.

## Confirmed Behavior

- Clear the entire inventory regardless of search or active filters.
- Preserve models, colors, product variants, low-stock thresholds, and all previous documents.
- Record the clear as one `ADJUSTMENT` stock document with one negative line for every variant whose current quantity is greater than zero.
- Do not create a document when every balance is already zero.
- Keep the feature available to all users because the application intentionally has no login or role restrictions.

## User Interface

The inventory page header will add a destructive outline button labeled `ล้างสต๊อก` near the right-side inventory summaries. The button is disabled while a clear is running and when the total quantity across the entire snapshot is zero. Its disabled state does not depend on the current filters.

Pressing the button opens SweetAlert2 with:

- a warning icon and the count of positive-balance variants and pairs across the entire inventory, regardless of filters;
- a text input requiring the exact phrase `ล้างสต๊อก`;
- a red `ยืนยันล้างสต๊อก` button and a cancel button;
- inline validation when the confirmation phrase is wrong;
- a loader during the mutation, with outside click and Escape disabled while loading.

After success, SweetAlert2 reports how many pairs were cleared and the page refreshes to show zero pairs. If the request fails, the alert remains actionable and displays a Thai error; the database transaction leaves all balances unchanged.

SweetAlert2's documented `input`, asynchronous `preConfirm`, `showLoaderOnConfirm`, `showValidationMessage`, and `allowOutsideClick` APIs will be used. The package will be installed locally rather than loaded from a CDN.

## Application Contract

Extend `InventoryRepository` and the inventory provider with:

```ts
clearStock(effectiveDate: string): Promise<StockDocument | null>
```

The method returns the generated adjustment document, or `null` when there was no positive stock to clear. The provider runs the mutation through its existing refresh and error-normalization path.

The demo repository performs the clear inside its existing mutation lock, derives lines from the current stored snapshot, posts one adjustment document, and persists the resulting zero balances and history together.

## Supabase Transaction

Add migration `supabase/migrations/202607220003_clear_inventory_stock.sql` with a `security definer` RPC named `clear_inventory_stock(command jsonb)`.

The command contains a UUID `requestId` and ISO `effectiveDate`. The RPC will:

1. Validate the command and serialize duplicate attempts using the same advisory-lock/idempotency pattern as `post_stock_document`.
2. Return the previously created document if the request UUID was already committed.
3. Lock all inventory balance rows in deterministic `variant_id` order.
4. Read the locked positive quantities and return `null` if none exist.
5. Insert one `ADJUSTMENT` document with reference `CLEAR-STOCK` and note `ล้างสต๊อกทั้งคลัง`.
6. Insert one document line per positive balance, using the negative locked quantity as the delta.
7. Set every locked positive balance to zero.
8. Return the document in the same JSON shape used by the repository.

The document insert, line inserts, and balance updates occur in one PostgreSQL transaction. Existing stock mutations lock balances in the same deterministic order, so a clear is ordered safely against concurrent receipts, issues, exchanges, and adjustments. A mutation committed after the clear may legitimately add stock from zero.

Execution is revoked from `public` and granted to `anon` and `authenticated`, matching the application's current shared-access policy. Direct table mutation remains revoked.

## Supabase Client

Add `clear_inventory_stock` to the generated-style `InventoryDatabase` function types. `SupabaseInventoryRepository.clearStock` sends a fresh request UUID and maps the returned document with the existing document validation/mapping path. A `null` RPC result is returned as `null` without error.

## Error Handling and Safety

- Confirmation is case- and whitespace-sensitive: only exact `ล้างสต๊อก` proceeds.
- The frontend never constructs adjustment quantities for Supabase; the RPC reads locked current quantities to avoid stale-snapshot races.
- Repeated calls after a successful clear are harmless because no positive rows remain.
- Repeating the same request UUID returns the original document rather than duplicating history.
- There is no authorization boundary beyond possession of the public application credentials; typed confirmation protects against accidental UI activation, not a malicious caller.

## Testing

- Domain/demo repository tests: all positive balances become zero, zero balances create no lines, catalog and prior history remain, and one adjustment document records exact negative deltas.
- Supabase repository tests: correct RPC arguments, mapped document result, `null` handling, and error mapping.
- Migration tests: function security, grants, deterministic row locking, idempotency, audit inserts, zero updates, and absence of direct table grants.
- Provider tests: `clearStock` uses the mutation/refresh path.
- Inventory page tests: disabled state at zero, SweetAlert2 exact-phrase validation, success refresh, and failure feedback.
- Playwright demo test: clear stock through the real SweetAlert2 dialog and verify the variant count remains while the pair total becomes zero, the catalog is preserved, history is recorded, and no horizontal overflow occurs at desktop and mobile widths.

## Out of Scope

- Deleting history or catalog records.
- Clearing only filtered rows.
- Undoing a clear automatically.
- Adding login, roles, or permissions.
