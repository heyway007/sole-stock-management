# Production Order Pricing and A4 Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add required per-line unit prices, automatic monetary totals, legacy-order compatibility, and a company-branded responsive A4 production-order print layout.

**Architecture:** Keep price as a snapshot on each production-order line and derive line/grand totals through one integer-satang money module. Extend the existing optional line-editor surface without changing inventory behavior, preserve legacy orders with `unitPrice: null`, and add a forward-only Supabase migration that is created and tested locally but not deployed.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Zod 4, Supabase PostgreSQL/RPC, Vitest, Testing Library, Playwright, CSS print media.

## Global Constraints

- Work on the existing `master` branch; do not create a worktree.
- Preserve the pre-existing unstaged change in `next-env.d.ts`.
- Do not deploy the new Supabase migration.
- Do not push Git or trigger a Cloudflare Worker build.
- Run and present the result locally in demo mode before requesting rollout approval.
- Unit price is required for every line saved by the new application, must be greater than `0`, and supports at most 2 decimal places.
- Legacy lines without a price remain readable, printable, and receivable with `unitPrice: null`; display `—`, never `0.00`.
- Company data is fixed and must omit the legal-entity/tax registration number.
- Printed A4 header keeps company/address details on the left and document/date details on the right.

## File Structure

- Create `src/features/production-orders/domain/money.ts`: integer-satang conversion, multiplication, aggregation, and Thai baht formatting.
- Modify `src/features/production-orders/domain/types.ts`: required input price, nullable persisted legacy price, and price validation code.
- Modify `src/features/production-orders/domain/validation.ts`: enforce the unit-price contract.
- Modify `src/features/production-orders/domain/selectors.ts`: compute total pairs and completeness-aware monetary totals.
- Modify `src/features/production-orders/data/demo-production-order-repository.ts`: snapshot prices and project v1 local data without prices.
- Modify `src/features/production-orders/data/supabase-production-order-repository.ts`: validate/map nullable prices and send required prices.
- Create `supabase/migrations/202607230006_production_order_pricing.sql`: nullable column for history, positive constraint, JSON projection, and save-RPC validation.
- Modify `src/features/inventory/components/document-line-editor.tsx`: expose an optional extra-fields render hook only.
- Create `src/features/production-orders/components/production-order-line-price.tsx`: production-specific price input and calculated line amount.
- Modify `src/features/production-orders/components/production-order-form.tsx`: manage price drafts, validation, live totals, and legacy edit behavior.
- Create `src/features/production-orders/company-profile.ts`: one source for fixed company identity and contacts.
- Modify `src/app/production-orders/[id]/page.tsx`: show price, amount, and completeness-aware total on desktop/mobile.
- Modify `src/features/production-orders/components/production-order-print.tsx`: branded two-column header and six-column priced table.
- Modify `src/app/globals.css`: form, detail, preview, responsive, and A4 print layout.
- Update focused unit/component/E2E tests listed in the tasks below.

---

### Task 1: Money Domain, Types, Validation, and Selectors

**Files:**
- Create: `src/features/production-orders/domain/money.ts`
- Modify: `src/features/production-orders/domain/types.ts`
- Modify: `src/features/production-orders/domain/validation.ts`
- Modify: `src/features/production-orders/domain/selectors.ts`
- Create: `tests/unit/production-order-money.test.ts`
- Modify: `tests/unit/production-order-domain.test.ts`

**Interfaces:**
- Produces: `amountToMinor(value: number | null): number | null`
- Produces: `parseUnitPriceInput(value: string): number | null`
- Produces: `lineTotalMinor(quantity: number, unitPrice: number | null): number | null`
- Produces: `formatBahtMinor(value: number | null): string`
- Produces: `ProductionOrderLineInput.unitPrice: number`
- Produces: `ProductionOrderLine.unitPrice: number | null`
- Produces: `summarizeProductionOrder(order): { lineCount; totalPairs; hasCompletePricing; totalAmountMinor }`

- [ ] **Step 1: Write failing money and domain tests**

Add focused expectations:

```ts
expect(parseUnitPriceInput("327")).toBe(327);
expect(parseUnitPriceInput("327.50")).toBe(327.5);
expect(parseUnitPriceInput("327.555")).toBeNull();
expect(amountToMinor(327.5)).toBe(32750);
expect(lineTotalMinor(10, 327.5)).toBe(327500);
expect(formatBahtMinor(327500)).toBe("3,275.00 บาท");

const pricedInput: ProductionOrderInput = {
  orderDate: "2026-07-22",
  expectedDate: "2026-08-05",
  note: "",
  lines: [{ variantId: "variant-1", quantity: 10, unitPrice: 327 }],
};
expect(validateProductionOrder(pricedInput).success).toBe(true);
expect(validateProductionOrder({
  ...pricedInput,
  lines: [{ ...pricedInput.lines[0], unitPrice: 0 }],
})).toMatchObject({
  success: false,
  errors: [expect.objectContaining({
    path: "lines.0.unitPrice",
    code: "INVALID_UNIT_PRICE",
  })],
});
expect(validateProductionOrder({
  ...pricedInput,
  lines: [{ ...pricedInput.lines[0], unitPrice: 327.555 }],
}).success).toBe(false);
```

Update the order fixture with `unitPrice: 327` and `unitPrice: 265`, then assert:

```ts
expect(summarizeProductionOrder(order)).toEqual({
  lineCount: 2,
  totalPairs: 10,
  hasCompletePricing: true,
  totalAmountMinor: 297800,
});
expect(summarizeProductionOrder({
  ...order,
  lines: order.lines.map((line, index) =>
    index === 0 ? { ...line, unitPrice: null } : line),
})).toMatchObject({
  hasCompletePricing: false,
  totalAmountMinor: null,
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```powershell
npx vitest run tests/unit/production-order-money.test.ts tests/unit/production-order-domain.test.ts
```

Expected: FAIL because `money.ts`, `unitPrice`, and completeness-aware totals do not exist.

- [ ] **Step 3: Implement integer-satang money helpers**

Create the module with these contracts:

```ts
const MAX_UNIT_PRICE_MINOR = 999_999_999_999;
const BAHT_FORMATTER = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function amountToMinor(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8;
  if (Math.abs(scaled - rounded) > tolerance || rounded > MAX_UNIT_PRICE_MINOR) return null;
  return rounded;
}

export function parseUnitPriceInput(value: string): number | null {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return amountToMinor(amount) === null ? null : amount;
}

export function lineTotalMinor(quantity: number, unitPrice: number | null): number | null {
  const unitMinor = amountToMinor(unitPrice);
  if (!Number.isInteger(quantity) || quantity <= 0 || unitMinor === null) return null;
  const total = quantity * unitMinor;
  return Number.isSafeInteger(total) ? total : null;
}

export function formatBahtMinor(value: number | null): string {
  return value === null ? "—" : `${BAHT_FORMATTER.format(value / 100)} บาท`;
}
```

- [ ] **Step 4: Extend types, schema, error mapping, and selectors**

Use separate input and stored line shapes:

```ts
export interface ProductionOrderLineInput {
  variantId: string;
  quantity: number;
  unitPrice: number;
}

export interface ProductionOrderLine {
  id: string;
  variantId: string;
  lineNumber: number;
  modelName: string;
  colorName: string;
  size: string;
  quantity: number;
  unitPrice: number | null;
}
```

Add `INVALID_UNIT_PRICE` to `ProductionOrderValidationError["code"]`. Validate with a Zod refinement that calls `amountToMinor`, and map `lines.N.unitPrice` to:

```ts
{
  path,
  code: "INVALID_UNIT_PRICE",
  message: "ราคาต่อหน่วยต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง",
}
```

Calculate the summary without partial totals:

```ts
const lineTotals = order.lines.map((line) =>
  lineTotalMinor(line.quantity, line.unitPrice));
const hasCompletePricing = lineTotals.every((value) => value !== null);
return {
  lineCount: order.lines.length,
  totalPairs: order.lines.reduce((total, line) => total + line.quantity, 0),
  hasCompletePricing,
  totalAmountMinor: hasCompletePricing
    ? lineTotals.reduce<number>((total, value) => total + (value ?? 0), 0)
    : null,
};
```

- [ ] **Step 5: Run focused tests and commit**

Run:

```powershell
npx vitest run tests/unit/production-order-money.test.ts tests/unit/production-order-domain.test.ts
```

Expected: PASS.

Commit:

```powershell
git add src/features/production-orders/domain tests/unit/production-order-money.test.ts tests/unit/production-order-domain.test.ts
git commit -m "feat: add production order money domain"
```

---

### Task 2: Demo Repository and Legacy Local Data

**Files:**
- Modify: `src/features/production-orders/data/demo-production-order-repository.ts`
- Modify: `tests/unit/demo-production-order-repository.test.ts`

**Interfaces:**
- Consumes: `ProductionOrderLineInput.unitPrice`
- Consumes: `ProductionOrderLine.unitPrice: number | null`
- Produces: legacy localStorage projection with `unitPrice: null`

- [ ] **Step 1: Add failing repository tests**

Add a save assertion:

```ts
const saved = await repository.save({
  orderDate: "2026-07-23",
  expectedDate: "2026-08-01",
  note: "",
  lines: [{ variantId: "paris-black-m", quantity: 4, unitPrice: 327.5 }],
});
expect(saved.lines[0]).toMatchObject({
  quantity: 4,
  unitPrice: 327.5,
});
```

Seed a valid v1 state whose line has no `unitPrice`, load it, and assert:

```ts
await expect(repository.load()).resolves.toEqual([
  expect.objectContaining({
    lines: [expect.objectContaining({ unitPrice: null })],
  }),
]);
```

Also assert receiving that legacy order still posts the original variant, size, and quantity.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npx vitest run tests/unit/demo-production-order-repository.test.ts
```

Expected: FAIL because snapshot validation currently rejects/misses `unitPrice`.

- [ ] **Step 3: Snapshot price and project legacy lines**

In `snapshotLine`, add:

```ts
unitPrice: input.unitPrice,
```

In `isProductionOrderLineRecord`, accept only `null` or a valid amount:

```ts
&& (value.unitPrice === null
  || (typeof value.unitPrice === "number" && amountToMinor(value.unitPrice) !== null))
```

In `projectDemoState`, normalize both size and price:

```ts
const size = normalizeSizeLabel(line.size);
const unitPrice = "unitPrice" in line ? line.unitPrice : null;
return size ? { ...line, size, unitPrice } : line;
```

Do not change the receive mapping; it must remain:

```ts
{
  variantId: line.variantId,
  size: line.size,
  quantity: line.quantity,
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```powershell
npx vitest run tests/unit/demo-production-order-repository.test.ts tests/unit/production-order-domain.test.ts
```

Expected: PASS.

Commit:

```powershell
git add src/features/production-orders/data/demo-production-order-repository.ts tests/unit/demo-production-order-repository.test.ts
git commit -m "feat: persist production prices in demo storage"
```

---

### Task 3: Supabase Contract and Forward Migration

**Files:**
- Create: `supabase/migrations/202607230006_production_order_pricing.sql`
- Modify: `src/features/production-orders/data/supabase-production-order-repository.ts`
- Modify: `tests/unit/supabase-production-order-repository.test.ts`
- Modify: `tests/unit/supabase-migration.test.ts`

**Interfaces:**
- Consumes: saved JSON key `unitPrice`
- Produces: `public.production_order_lines.unit_price numeric(12,2)`
- Produces: `production_order_json(...).lines[].unitPrice`
- Produces: `save_production_order(command)` requiring positive two-decimal prices

- [ ] **Step 1: Add failing mapping and migration contract tests**

Extend RPC fixtures:

```ts
lines: [{
  id: "line-1",
  variantId: "variant-1",
  lineNumber: 1,
  modelName: "Paris",
  colorName: "Black",
  size: "M",
  quantity: 4,
  unitPrice: 327.5,
}],
```

Assert the save command includes:

```ts
lines: [{ variantId: "variant-1", quantity: 4, unitPrice: 327.5 }]
```

Add a legacy response fixture with `unitPrice: null` and expect it to map successfully. Add malformed fixtures for `unitPrice: 0`, `unitPrice: -1`, and `unitPrice: 1.234`, and expect the existing Thai malformed-response error.

Add migration assertions:

```ts
expect(pricingMigration).toContain(
  "add column unit_price numeric(12,2)"
);
expect(pricingMigration).toContain(
  "unit_price is null or unit_price > 0"
);
expect(pricingMigration).toContain("'unitPrice', line.unit_price");
expect(pricingMigration).toContain(
  "pg_catalog.jsonb_typeof(line -> 'unitPrice') is distinct from 'number'"
);
expect(pricingMigration).not.toMatch(
  /delete\s+from\s+public\.(?:production_orders|production_order_lines)/i
);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```powershell
npx vitest run tests/unit/supabase-production-order-repository.test.ts tests/unit/supabase-migration.test.ts
```

Expected: FAIL because migration 006 and price mapping do not exist.

- [ ] **Step 3: Implement strict repository mapping**

Import `amountToMinor`, require `unitPrice` to be either `null` or a valid number, and return it:

```ts
const unitPrice = value.unitPrice;
if (unitPrice !== null
  && (typeof unitPrice !== "number" || amountToMinor(unitPrice) === null)) {
  throw new Error("ข้อมูลใบผลิตจากเซิร์ฟเวอร์ไม่ถูกต้อง");
}
return {
  id: value.id,
  variantId: value.variantId,
  lineNumber: value.lineNumber,
  modelName: value.modelName,
  colorName: value.colorName,
  size,
  quantity: value.quantity,
  unitPrice,
};
```

The existing save command spreads validated input, so keep the command shape and verify its test now includes `unitPrice`.

- [ ] **Step 4: Write the migration**

The migration must:

```sql
alter table public.production_order_lines
  add column unit_price numeric(12,2);

alter table public.production_order_lines
  add constraint production_order_lines_unit_price_positive
  check (unit_price is null or unit_price > 0);
```

Recreate `production_order_json` from migration 005 and add:

```sql
'unitPrice', line.unit_price
```

Recreate `save_production_order` from migration 005 with:

```sql
line_unit_price_numeric numeric;
```

Validate every submitted line:

```sql
or pg_catalog.jsonb_typeof(line -> 'unitPrice') is distinct from 'number'
```

Parse and validate:

```sql
line_unit_price_numeric := (line ->> 'unitPrice')::numeric;
if line_unit_price_numeric <= 0
  or line_unit_price_numeric > 9999999999.99
  or line_unit_price_numeric <> pg_catalog.round(line_unit_price_numeric, 2) then
  raise exception using errcode = 'P0001', message = 'INVALID_PRODUCTION_ORDER';
end if;
```

Insert `unit_price` with `line_unit_price_numeric`. Preserve advisory locks, idempotent request IDs, order-status checks, variant snapshots, grants, and ownership from migration 005.

- [ ] **Step 5: Run tests and commit without deploying**

Run:

```powershell
npx vitest run tests/unit/supabase-production-order-repository.test.ts tests/unit/supabase-migration.test.ts
```

Expected: PASS.

Do not run `npx supabase db push`.

Commit:

```powershell
git add supabase/migrations/202607230006_production_order_pricing.sql src/features/production-orders/data/supabase-production-order-repository.ts tests/unit/supabase-production-order-repository.test.ts tests/unit/supabase-migration.test.ts
git commit -m "feat: add production price persistence contract"
```

---

### Task 4: Production Order Price Fields and Live Form Totals

**Files:**
- Modify: `src/features/inventory/components/document-line-editor.tsx`
- Create: `src/features/production-orders/components/production-order-line-price.tsx`
- Modify: `src/features/production-orders/components/production-order-form.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/components/production-order-form.test.tsx`
- Modify: `tests/components/receive-page.test.tsx`
- Modify: `tests/components/issue-page.test.tsx`
- Modify: `tests/components/exchange-page.test.tsx`

**Interfaces:**
- Consumes: `parseUnitPriceInput`, `lineTotalMinor`, `formatBahtMinor`
- Produces: optional `extraLineFields(context)` hook on `DocumentLineEditor`
- Produces: production draft `unitPrice: string`

- [ ] **Step 1: Add failing form behavior tests**

After selecting Paris/Black/M and entering quantity `10`, assert:

```ts
const price = screen.getByRole("spinbutton", {
  name: "ราคาต่อหน่วย รายการ 1",
});
await user.type(price, "327");
expect(screen.getByText("3,270.00 บาท")).toBeInTheDocument();
expect(screen.getByText(/รวม 1 รายการ · 10 คู่ · 3,270.00 บาท/))
  .toBeInTheDocument();
```

Submit and assert:

```ts
expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
  lines: [expect.objectContaining({
    quantity: 10,
    unitPrice: 327,
  })],
}));
```

Add invalid-price cases for empty, `0`, and `327.555`. Add edit coverage where `unitPrice: null` renders an empty price input and blocks save until completed.

- [ ] **Step 2: Run the form test and verify failure**

Run:

```powershell
npx vitest run tests/components/production-order-form.test.tsx
```

Expected: FAIL because no price control or totals are rendered.

- [ ] **Step 3: Add a generic optional extra-fields hook**

Extend `DocumentLineDraft`:

```ts
unitPrice?: string;
```

Export:

```ts
export interface DocumentLineExtraFieldsContext {
  line: DocumentLineDraft;
  index: number;
  rowNumber: number;
  controlId: string;
  updateLine(update: Partial<DocumentLineDraft>, fields: string[]): void;
}
```

Add the prop:

```ts
extraLineFields?: (context: DocumentLineExtraFieldsContext) => ReactNode;
```

After the quantity `Field`, render:

```tsx
{extraLineFields?.({
  line,
  index: validationIndex,
  rowNumber,
  controlId,
  updateLine: (update, fields) => updateLine(line.id, update, fields),
})}
```

Default behavior remains unchanged when the prop is absent.

- [ ] **Step 4: Implement the production-specific price controls**

`ProductionOrderLinePrice` receives the exported context, reads the unit-price error, and renders:

```tsx
const parsedPrice = parseUnitPriceInput(line.unitPrice ?? "");
const quantity = Number(line.quantity);
const total = parsedPrice === null
  ? null
  : lineTotalMinor(quantity, parsedPrice);

return (
  <>
    <Field
      id={`${controlId}-unit-price`}
      label={`ราคาต่อหน่วย รายการ ${rowNumber}`}
      type="number"
      min="0.01"
      step="0.01"
      inputMode="decimal"
      value={line.unitPrice ?? ""}
      error={errorFor(`lines.${index}.unitPrice`)}
      announceError={false}
      onChange={(event) =>
        updateLine({ unitPrice: event.target.value }, ["unitPrice"])}
    />
    <output className="production-line-amount" htmlFor={`${controlId}-unit-price`}>
      <span>จำนวนเงิน</span>
      <strong>{formatBahtMinor(total)}</strong>
    </output>
  </>
);
```

- [ ] **Step 5: Wire form drafts, validation, fingerprint, and summary**

New lines use:

```ts
{ ...createDocumentLine(), unitPrice: "" }
```

Existing lines use:

```ts
unitPrice: line.unitPrice === null ? "" : String(line.unitPrice),
```

Map form input:

```ts
unitPrice: parseUnitPriceInput(line.unitPrice ?? "") ?? Number.NaN,
```

Include `unitPrice` in the dirty fingerprint. Pass:

```tsx
extraLineFields={(context) => <ProductionOrderLinePrice {...context} />}
```

Render the summary from valid draft line totals only, but show `—` for the monetary total until every visible line has valid product, quantity, and price.

- [ ] **Step 6: Style and run regression tests**

Add production-only grid rules:

```css
.production-line-amount {
  min-height: 44px;
  display: grid;
  align-content: center;
  gap: 2px;
  border-radius: 10px;
  background: #f3f5f1;
  padding: 8px 10px;
}
.production-line-amount span { color: var(--muted); font-size: 0.72rem; }
.production-line-amount strong { color: var(--forest-800); }

@media (min-width: 1024px) {
  .production-order-form .document-line {
    grid-template-columns: repeat(3, minmax(120px, 1fr))
      minmax(110px, .65fr) minmax(130px, .8fr)
      minmax(140px, .9fr) auto;
  }
}
```

Run:

```powershell
npx vitest run tests/components/production-order-form.test.tsx tests/components/receive-page.test.tsx tests/components/issue-page.test.tsx tests/components/exchange-page.test.tsx
```

Expected: PASS and inventory forms have no price field.

Commit:

```powershell
git add src/features/inventory/components/document-line-editor.tsx src/features/production-orders/components/production-order-line-price.tsx src/features/production-orders/components/production-order-form.tsx src/app/globals.css tests/components
git commit -m "feat: calculate production order prices in form"
```

---

### Task 5: Priced Detail Page

**Files:**
- Modify: `src/app/production-orders/[id]/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/components/production-order-detail.test.tsx`

**Interfaces:**
- Consumes: `lineTotalMinor`, `formatBahtMinor`, `summarizeProductionOrder`
- Produces: desktop table and mobile cards with price and line amount

- [ ] **Step 1: Add failing detail tests**

Use a line with `quantity: 10, unitPrice: 327` and assert:

```ts
expect(screen.getByText("327.00 บาท")).toBeInTheDocument();
expect(screen.getByText("3,270.00 บาท")).toBeInTheDocument();
expect(screen.getByText(/ยอดรวมสุทธิ/)).toHaveTextContent("3,270.00 บาท");
```

Rerender a legacy line with `unitPrice: null` and assert the detail area shows `—` and the explanatory text `ข้อมูลราคายังไม่ครบ`.

- [ ] **Step 2: Run the detail test and verify failure**

Run:

```powershell
npx vitest run tests/components/production-order-detail.test.tsx
```

Expected: FAIL because price columns and summary do not exist.

- [ ] **Step 3: Add price columns and mobile values**

Change the desktop headers to:

```tsx
<th>#</th>
<th>รุ่น</th>
<th>สี</th>
<th>ไซซ์</th>
<th>จำนวน</th>
<th>ราคา/หน่วย</th>
<th>จำนวนเงิน</th>
```

For each line:

```tsx
<td>{formatBahtMinor(amountToMinor(line.unitPrice))}</td>
<td>{formatBahtMinor(lineTotalMinor(line.quantity, line.unitPrice))}</td>
```

In mobile cards, render the same values under quantity. In the footer:

```tsx
รวม {summary.lineCount} รายการ · {summary.totalPairs} คู่ ·
 ยอดรวมสุทธิ {formatBahtMinor(summary.totalAmountMinor)}
{!summary.hasCompletePricing && <span>ข้อมูลราคายังไม่ครบ</span>}
```

- [ ] **Step 4: Style, run, and commit**

Keep amounts right-aligned and allow cards to wrap on narrow screens. Run:

```powershell
npx vitest run tests/components/production-order-detail.test.tsx
```

Expected: PASS.

Commit:

```powershell
git add -- 'src/app/production-orders/[id]/page.tsx' src/app/globals.css tests/components/production-order-detail.test.tsx
git commit -m "feat: show production order monetary totals"
```

---

### Task 6: Company-Branded A4 Print

**Files:**
- Create: `src/features/production-orders/company-profile.ts`
- Modify: `src/features/production-orders/components/production-order-print.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/components/production-order-print.test.tsx`

**Interfaces:**
- Produces: `PRODUCTION_COMPANY_PROFILE`
- Consumes: completeness-aware summary and money formatter

- [ ] **Step 1: Add failing print assertions**

Assert:

```ts
expect(screen.getByText("STRUGGER STUDIO NO.45 CO., LTD.")).toBeInTheDocument();
expect(screen.getByText("บริษัท สตรักเกอร์ สตูดิโอ โน.45 จำกัด")).toBeInTheDocument();
expect(screen.getByText(/เลขที่ 20 ซอย เอกชัย 80\/1/)).toBeInTheDocument();
expect(screen.getByText(/084-245-5971/)).toBeInTheDocument();
expect(screen.getByText(/@struggerofficial/)).toBeInTheDocument();
expect(screen.getByText(/Struggerofficial@gmail.com/)).toBeInTheDocument();
expect(screen.queryByText(/0105569069428/)).not.toBeInTheDocument();
```

Within the table assert headers `รายละเอียด สี/ไซซ์`, `ราคา/หน่วย`, `จำนวนเงิน`, and values `327.00`, `3,270.00`. Assert the header has separate `.production-print-company` and `.production-print-document` containers.

- [ ] **Step 2: Run the print test and verify failure**

Run:

```powershell
npx vitest run tests/components/production-order-print.test.tsx
```

Expected: FAIL because the old SOLE STOCK header and five-column table are still rendered.

- [ ] **Step 3: Add the fixed company profile**

Create:

```ts
export const PRODUCTION_COMPANY_PROFILE = {
  englishName: "STRUGGER STUDIO NO.45 CO., LTD.",
  thaiName: "บริษัท สตรักเกอร์ สตูดิโอ โน.45 จำกัด",
  address: "เลขที่ 20 ซอย เอกชัย 80/1 ถนน เอกชัย แขวงคลองบางพราน เขตบางบอน กรุงเทพมหานคร 10150 (สำนักงานใหญ่)",
  phone: "084-245-5971",
  line: "@struggerofficial",
  email: "Struggerofficial@gmail.com",
} as const;
```

Do not add a registration-number field.

- [ ] **Step 4: Replace the print structure**

Use:

```tsx
<header className="production-print-header">
  <section className="production-print-company" aria-label="ข้อมูลบริษัท">
    <strong>{profile.englishName}</strong>
    <h2>{profile.thaiName}</h2>
    <address>
      <p>{profile.address}</p>
      <p>โทร. {profile.phone}</p>
      <p>Line: {profile.line}</p>
      <p>{profile.email}</p>
    </address>
  </section>
  <section className="production-print-document" aria-label="ข้อมูลเอกสาร">
    <h1>ใบสั่งผลิต</h1>
    <dl>
      <div><dt>เลขที่</dt><dd>{order.number}</dd></div>
      <div><dt>วันที่สั่งผลิต</dt><dd>{order.orderDate}</dd></div>
      <div><dt>วันที่กำหนดรับ</dt><dd>{order.expectedDate}</dd></div>
      <div><dt>สถานะ</dt><dd>{statusLabels[order.status]}</dd></div>
    </dl>
  </section>
</header>
```

Render six table columns. Combine details as `${line.colorName} / ${line.size}`. The footer contains total pairs and `formatBahtMinor(summary.totalAmountMinor)`. Keep note and two signature blocks.

- [ ] **Step 5: Implement responsive preview and A4 CSS**

Use a two-column header at print/Desktop:

```css
.production-print-header {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(230px, .65fr);
  gap: 28px;
}
.production-print-company address { margin-top: 10px; font-style: normal; }
.production-print-company address p { margin: 3px 0; }
.production-print-document { text-align: right; }
.production-print-document dl { display: grid; gap: 5px; margin: 12px 0 0; }
.production-print-document dl > div {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
}
.production-print-document dd { margin: 0; font-weight: 700; }
```

At `max-width: 599px`, stack preview sections. Inside `@media print`, explicitly restore the two-column grid so A4 always prints company left and dates right. Add `break-inside: avoid` for rows, totals, and signatures.

- [ ] **Step 6: Run and commit**

Run:

```powershell
npx vitest run tests/components/production-order-print.test.tsx
```

Expected: PASS, including the existing `window.print()` expectation.

Commit:

```powershell
git add src/features/production-orders/company-profile.ts src/features/production-orders/components/production-order-print.tsx src/app/globals.css tests/components/production-order-print.test.tsx
git commit -m "feat: redesign production order A4 print"
```

---

### Task 7: Cross-Feature Regression, E2E, and Local Review Server

**Files:**
- Modify: `tests/e2e/inventory.spec.ts`
- Modify fixtures in production-order tests that now require `unitPrice`
- No production file should be changed unless a failing regression exposes a concrete defect

**Interfaces:**
- Consumes: all completed production-order pricing and print behavior
- Produces: verified local demo-mode review URL

- [ ] **Step 1: Add an E2E production-order pricing scenario**

Create a production order in demo mode:

```ts
await page.goto("/production-orders/new");
await page.getByRole("combobox", { name: "รุ่นสินค้า รายการ 1" }).selectOption("paris");
await page.getByRole("combobox", { name: "สีสินค้า รายการ 1" }).selectOption("black");
await page.getByRole("combobox", { name: "ไซซ์ รายการ 1" }).selectOption("M");
await page.getByRole("spinbutton", { name: "จำนวน (คู่) รายการ 1" }).fill("10");
await page.getByRole("spinbutton", { name: "ราคาต่อหน่วย รายการ 1" }).fill("327");
await expect(page.getByText("3,270.00 บาท")).toBeVisible();
await page.getByRole("button", { name: "บันทึกใบผลิต" }).click();
await expect(page.getByText("ยอดรวมสุทธิ")).toBeVisible();
```

Open the print route from the detail action and assert company-left/document-right containers and the calculated total are visible.

- [ ] **Step 2: Run production-order and inventory tests**

Run:

```powershell
npx vitest run tests/unit/production-order-money.test.ts tests/unit/production-order-domain.test.ts tests/unit/demo-production-order-repository.test.ts tests/unit/supabase-production-order-repository.test.ts tests/unit/supabase-migration.test.ts tests/components/production-order-form.test.tsx tests/components/production-order-detail.test.tsx tests/components/production-order-print.test.tsx tests/components/production-order-actions.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run the full quality gate**

Run:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run e2e
```

Expected: all commands exit `0`. If OneDrive holds a stale `.next` build handle, move only the verified `C:\Users\ASUS\OneDrive\Documents\management-mark\.next` directory to a timestamped folder under `$env:TEMP`, then rerun `npm run build`; do not delete user files.

- [ ] **Step 4: Verify migration remains local-only**

Run:

```powershell
npx supabase migration list
git status --short
git log --oneline -8
```

Expected:

- migration `202607230006` exists locally and is not in the remote-applied column;
- `next-env.d.ts` remains an unstaged user modification;
- no unplanned files are staged;
- no push command has run.

- [ ] **Step 5: Start the local demo review server**

Use PowerShell environment override so the real Supabase project does not need migration 006:

```powershell
$env:NEXT_PUBLIC_INVENTORY_BACKEND="demo"
npm run dev
```

Expected: Next.js reports a local URL, normally `http://localhost:3000`. Verify:

- new production order requires a price;
- row and grand totals update immediately;
- detail page shows price and totals;
- print preview stacks correctly on mobile;
- A4 preview uses company details on the left and document details on the right;
- browser print dialog opens and offers Save as PDF/More settings;
- receiving the order into stock still changes only quantities.

- [ ] **Step 6: Commit E2E/fixture updates and hand off local review**

Commit only tracked implementation/test/migration files:

```powershell
git add tests/e2e/inventory.spec.ts tests
git commit -m "test: cover production order pricing workflow"
```

Do not stage `next-env.d.ts`. Do not deploy or push. Report the local URL and wait for the user to approve the interface before any remote operation.
