# Production Order Discount Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted informational `ส่วนลด (บาท)` field to production-order create and edit forms without changing any totals or downstream views.

**Architecture:** Add a required non-negative `discount` value to the production-order domain and persist it in both repository implementations. A forward Supabase migration adds the column and updates the JSON/save RPC boundary, while compatibility readers default legacy missing values to zero. The form owns a string draft, parses it to a normalized baht number, and leaves the existing line-total calculation untouched.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, Vitest, Testing Library, Supabase PostgreSQL RPC migrations

## Global Constraints

- The discount is informational only and must not change line totals, the form summary, inventory receipt behavior, the detail page, or the print layout.
- New orders default to `0`; edit forms restore the saved value.
- Empty input means `0`.
- Valid discounts are finite values from `0` upward with at most two decimal places.
- Legacy demo or Supabase orders without a discount load as `0`.
- Work is developed and verified on `codex/production-order-discount`; push to `main` only after all local checks pass.

---

## File Map

- `src/features/production-orders/domain/types.ts`: public input, order, and validation-error contracts.
- `src/features/production-orders/domain/money.ts`: exact two-decimal discount parsing and validation.
- `src/features/production-orders/domain/validation.ts`: domain validation and Thai discount error.
- `src/features/production-orders/data/demo-production-order-repository.ts`: local persistence and legacy projection.
- `src/features/production-orders/data/supabase-production-order-repository.ts`: RPC mapping and command serialization.
- `src/features/production-orders/components/production-order-form.tsx`: create/edit discount field and dirty-state behavior.
- `supabase/migrations/202607290008_production_order_discount.sql`: database column, constraint, JSON projection, and save RPC replacement.
- `tests/unit/production-order-money.test.ts`: parser boundary tests.
- `tests/unit/production-order-domain.test.ts`: validation tests.
- `tests/unit/demo-production-order-repository.test.ts`: create/edit/legacy persistence tests.
- `tests/unit/supabase-production-order-repository.test.ts`: compatibility and command contract tests.
- `tests/unit/supabase-migration.test.ts`: forward-migration contract tests.
- `tests/components/production-order-form.test.tsx`: create/edit UI behavior and unchanged totals.
- Existing production-order fixtures: add explicit `discount: 0` where required by the strengthened domain type.

---

### Task 1: Domain Discount Contract

**Files:**
- Modify: `src/features/production-orders/domain/types.ts`
- Modify: `src/features/production-orders/domain/money.ts`
- Modify: `src/features/production-orders/domain/validation.ts`
- Test: `tests/unit/production-order-money.test.ts`
- Test: `tests/unit/production-order-domain.test.ts`

**Interfaces:**
- Produces: `parseDiscountInput(value: string): number | null`
- Produces: `discountAmountToMinor(value: number): number | null`
- Produces: `ProductionOrderInput.discount: number`
- Produces: `ProductionOrder.discount: number`
- Produces: validation error code `INVALID_DISCOUNT`

- [ ] **Step 1: Write failing money tests**

```ts
expect(parseDiscountInput("")).toBe(0);
expect(parseDiscountInput("0")).toBe(0);
expect(parseDiscountInput("250")).toBe(250);
expect(parseDiscountInput("250.50")).toBe(250.5);
expect(parseDiscountInput("-1")).toBeNull();
expect(parseDiscountInput("1.234")).toBeNull();
expect(parseDiscountInput("1e3")).toBeNull();
```

- [ ] **Step 2: Run the money test and verify RED**

Run: `npm test -- tests/unit/production-order-money.test.ts`

Expected: FAIL because `parseDiscountInput` is not exported.

- [ ] **Step 3: Implement exact non-negative amount parsing**

Refactor the shared upper-bound constant to `MAX_AMOUNT_MINOR`. Add
`discountAmountToMinor` that accepts zero but rejects negative, non-finite,
over-precision, overflow, and out-of-range values. Add:

```ts
export function parseDiscountInput(value: string): number | null {
  const normalized = value.trim();
  if (normalized === "") return 0;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return discountAmountToMinor(amount) === null ? null : amount;
}
```

- [ ] **Step 4: Run the money test and verify GREEN**

Run: `npm test -- tests/unit/production-order-money.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing domain tests**

Add `discount: 0` to `validInput` and `order`. Assert successful normalization
of `discount: 250.5`, then extend invalid cases:

```ts
["negative discount", { ...validInput, discount: -1 }, "discount"],
["discount precision", { ...validInput, discount: 1.234 }, "discount"],
```

Assert the returned error includes:

```ts
expect.objectContaining({
  path: "discount",
  code: "INVALID_DISCOUNT",
})
```

- [ ] **Step 6: Run the domain test and verify RED**

Run: `npm test -- tests/unit/production-order-domain.test.ts`

Expected: FAIL because the domain does not validate or preserve `discount`.

- [ ] **Step 7: Implement domain types and validation**

Add `discount: number` to both order interfaces, add `INVALID_DISCOUNT` to the
error-code union, add this schema member:

```ts
discount: z.number().refine((value) => discountAmountToMinor(value) !== null),
```

Map the `discount` path to:

```ts
{
  path,
  code: "INVALID_DISCOUNT",
  message: "ส่วนลดต้องเป็น 0 หรือมากกว่า และมีทศนิยมไม่เกิน 2 ตำแหน่ง",
}
```

- [ ] **Step 8: Run both domain tests and verify GREEN**

Run: `npm test -- tests/unit/production-order-money.test.ts tests/unit/production-order-domain.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit the domain contract**

```powershell
git add src/features/production-orders/domain tests/unit/production-order-money.test.ts tests/unit/production-order-domain.test.ts
git commit -m "feat: add production order discount domain"
```

---

### Task 2: Demo and Supabase Repository Persistence

**Files:**
- Modify: `src/features/production-orders/data/demo-production-order-repository.ts`
- Modify: `src/features/production-orders/data/supabase-production-order-repository.ts`
- Test: `tests/unit/demo-production-order-repository.test.ts`
- Test: `tests/unit/supabase-production-order-repository.test.ts`
- Modify: existing production-order fixtures reported by `npm run typecheck`

**Interfaces:**
- Consumes: `ProductionOrderInput.discount: number`
- Consumes: `discountAmountToMinor(value: number): number | null`
- Produces: repository results with `ProductionOrder.discount: number`
- Produces: Supabase save command property `discount`

- [ ] **Step 1: Write failing demo persistence tests**

Create an order with `discount: 150`, edit it with `discount: 200.5`, and assert
both values are returned. In the legacy projection test, delete the persisted
order's `discount` property and assert:

```ts
expect(loaded[0].discount).toBe(0);
```

- [ ] **Step 2: Run the demo repository test and verify RED**

Run: `npm test -- tests/unit/demo-production-order-repository.test.ts`

Expected: FAIL because saved orders omit `discount` and legacy state does not
project it.

- [ ] **Step 3: Implement demo persistence and compatibility**

Copy `validated.data.discount` into both the create and edit order objects.
Extend `isProductionOrderRecord` to require a valid discount. In
`projectDemoState`, project each record with:

```ts
discount: "discount" in candidate ? candidate.discount : 0,
```

before validating the projected state.

- [ ] **Step 4: Run the demo repository test and verify GREEN**

Run: `npm test -- tests/unit/demo-production-order-repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing Supabase contract tests**

Add `discount: 150.5` to `openOrder` and the save input. Require the RPC call:

```ts
command: expect.objectContaining({
  discount: 150.5,
})
```

Add a load case that removes `discount` from the response and expects
`discount: 0`. Add malformed response cases for `-1` and `1.234`.

- [ ] **Step 6: Run the Supabase repository test and verify RED**

Run: `npm test -- tests/unit/supabase-production-order-repository.test.ts`

Expected: FAIL because mapping and command serialization omit `discount`.

- [ ] **Step 7: Implement Supabase mapping and serialization**

Read `value.discount ?? 0` in `mappedOrder`, validate it with
`discountAmountToMinor`, include it in the returned order, and add:

```ts
discount: input.discount,
```

to `commandFor`.

- [ ] **Step 8: Repair explicit fixtures and verify repositories**

Run: `npm run typecheck`

For every reported `ProductionOrder` or `ProductionOrderInput` fixture, add
`discount: 0`; do not make the property optional. Then run:

`npm test -- tests/unit/demo-production-order-repository.test.ts tests/unit/supabase-production-order-repository.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit repository persistence**

```powershell
git add src/features/production-orders/data tests
git commit -m "feat: persist production order discounts"
```

---

### Task 3: Supabase Forward Migration

**Files:**
- Create: `supabase/migrations/202607290008_production_order_discount.sql`
- Modify: `tests/unit/supabase-migration.test.ts`

**Interfaces:**
- Consumes: save command property `discount`
- Produces: `production_orders.discount numeric(14,2) not null default 0`
- Produces: JSON property `discount`

- [ ] **Step 1: Write the failing migration contract test**

Load the new migration and assert:

```ts
expect(discountMigration).toContain(
  "add column discount numeric(14,2) not null default 0",
);
expect(discountMigration).toContain("check (discount >= 0)");
expect(discountMigration).toContain("'discount', production_order.discount");
expect(discountMigration).toContain(
  "pg_catalog.jsonb_typeof(command -> 'discount') is distinct from 'number'",
);
expect(discountMigration).toContain(
  "discount_value := (command ->> 'discount')::numeric",
);
expect(discountMigration).not.toMatch(
  /delete\s+from\s+public\.(?:production_orders|production_order_lines)/,
);
```

- [ ] **Step 2: Run the migration test and verify RED**

Run: `npm test -- tests/unit/supabase-migration.test.ts`

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Create the forward migration**

The migration must:

```sql
begin;

alter table public.production_orders
  add column discount numeric(14,2) not null default 0;

alter table public.production_orders
  add constraint production_orders_discount_non_negative
  check (discount >= 0);
```

Replace `production_order_json(uuid)` using the current pricing migration as
the base and add `'discount', production_order.discount`.

Replace `save_production_order(jsonb)` using the current pricing migration as
the base. Declare `discount_value numeric`; reject a missing/non-number value;
cast it; reject values below zero, above `9999999999.99`, or with more than two
decimal places; include it in both the insert and update statements. Preserve
all existing request-id locking, status checks, line validation, ownership,
revokes, and narrow grants. End with `commit;`.

- [ ] **Step 4: Run the migration test and verify GREEN**

Run: `npm test -- tests/unit/supabase-migration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the migration**

```powershell
git add supabase/migrations/202607290008_production_order_discount.sql tests/unit/supabase-migration.test.ts
git commit -m "feat: add production order discount migration"
```

---

### Task 4: Create and Edit Form

**Files:**
- Modify: `src/features/production-orders/components/production-order-form.tsx`
- Test: `tests/components/production-order-form.test.tsx`

**Interfaces:**
- Consumes: `parseDiscountInput(value: string): number | null`
- Consumes: `ProductionOrder.discount: number`
- Produces: form submission `ProductionOrderInput.discount: number`

- [ ] **Step 1: Write failing create-form test**

In the create test, assert the new field starts at zero, replace it with
`150.50`, save, and require:

```ts
expect(screen.getByRole("spinbutton", { name: "ส่วนลด (บาท)" })).toHaveValue(0);
expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
  discount: 150.5,
}));
expect(screen.getByText("รวม 1 รายการ · 4 คู่ · 1,308.00 บาท")).toBeInTheDocument();
```

- [ ] **Step 2: Write failing edit-form test**

Render an open order with `discount: 200`, assert the field has value `200`,
change it to `250.25`, save, and require the saved order to contain
`discount: 250.25`.

- [ ] **Step 3: Run the component test and verify RED**

Run: `npm test -- tests/components/production-order-form.test.tsx`

Expected: FAIL because the discount field is absent.

- [ ] **Step 4: Implement form state and field**

Import `parseDiscountInput`. Initialize:

```ts
const initialDiscount = String(order?.discount ?? 0);
const [discount, setDiscount] = useState(initialDiscount);
```

Include parsed discount in `input` and `initialFingerprint`, using `Number.NaN`
only when parsing returns `null`. Add a `Field` to the metadata section:

```tsx
<Field
  id="production-discount"
  label="ส่วนลด (บาท)"
  type="number"
  min="0"
  step="0.01"
  inputMode="decimal"
  value={discount}
  error={validationContext.errorFor("discount")}
  onChange={(event) => {
    setDiscount(event.target.value);
    clearHeaderError("discount");
  }}
/>
```

The existing `totalAmountMinor` calculation must remain unchanged.

- [ ] **Step 5: Run the component test and verify GREEN**

Run: `npm test -- tests/components/production-order-form.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the form**

```powershell
git add src/features/production-orders/components/production-order-form.tsx tests/components/production-order-form.test.tsx
git commit -m "feat: add discount to production order form"
```

---

### Task 5: Local Verification and Production Release

**Files:**
- Verify all files changed in Tasks 1-4

**Interfaces:**
- Consumes: complete feature and migration
- Produces: tested `main` deployment and live confirmation

- [ ] **Step 1: Run the complete automated verification**

Run sequentially to avoid `.next` collisions:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all tests pass, typecheck has no errors, lint has no warnings, and
the production build completes.

- [ ] **Step 2: Run the app locally and verify create/edit behavior**

Start the documented local development command. In a browser, confirm:

- Create shows `ส่วนลด (บาท)` with `0`.
- Entering `150.50` does not change the displayed line total.
- Saving and reopening edit restores `150.5`.
- Editing and saving a new discount persists locally.

- [ ] **Step 3: Apply the Supabase migration**

Use the project's authorized Supabase migration path to apply
`202607290008_production_order_discount.sql`. Verify the column and RPC contract
before deploying the frontend. If the current account lacks project access,
stop the release and report the exact access blocker; do not claim the feature
is live.

- [ ] **Step 4: Push the verified branch state to main**

```powershell
git status --short
git push origin HEAD:main
```

Expected: the remote `main` SHA matches the local HEAD.

- [ ] **Step 5: Verify Cloudflare and the live application**

Confirm the Cloudflare build succeeds. On the production URL, create a test
order or edit an authorized open order, verify the discount restores after
reload, then leave the data in the user-approved state. Also confirm the
displayed total, detail page, and print view remain unchanged.
