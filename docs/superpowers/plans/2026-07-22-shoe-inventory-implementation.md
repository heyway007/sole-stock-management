# Shoe Inventory Management System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a responsive Thai-language Next.js shoe inventory application that records receipts, issues, adjustments, and atomic exchanges in demo mode and is ready to persist to Supabase PostgreSQL.

**Architecture:** Domain functions validate immutable stock documents and project their signed lines into non-negative balances. Pages consume an `InventoryRepository` through a client provider, allowing the same UI to use a versioned localStorage repository or a Supabase RPC repository. PostgreSQL owns the final atomicity guarantee when Supabase mode is enabled.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Zod, Supabase JavaScript client, Vitest, Testing Library, Playwright, ESLint

## Global Constraints

- The interface language is Thai.
- Version one has no authentication or role-based access.
- Initial models and colors are Paris: Black/Navy/Olive, Castor: Black/Brown/Olive, and Weave: Black/Brown/Sand.
- Sizes are positive decimal numbers including whole and half sizes.
- Quantities represent pairs and are positive whole numbers.
- Stock balances may never be negative.
- Receipts and issues support multiple lines per document.
- Issue reasons are sale, damage, and adjustment.
- An exchange posts returned and replacement lines atomically.
- Historical stock documents are immutable; corrections create adjustment documents.
- The application works without Supabase credentials using versioned localStorage.
- Supabase is selected only when required environment variables are present.
- Support widths from 360 px mobile to large desktop monitors.
- Touch targets are at least 44 by 44 CSS pixels.

---

## File Map

### Application shell and routes

- \`src/app/layout.tsx\`: fonts, metadata, global provider, and application shell.
- \`src/app/page.tsx\`: Operations Dashboard.
- \`src/app/inventory/page.tsx\`: searchable stock table/cards and threshold editing.
- \`src/app/receive/page.tsx\`: multi-line receipt.
- \`src/app/issue/page.tsx\`: sale, damage, and adjustment issue flow.
- \`src/app/exchange/page.tsx\`: returned/replacement exchange flow.
- \`src/app/history/page.tsx\`: document search, filtering, and detail dialog.
- \`src/app/catalog/page.tsx\`: model and color management.

### Domain and persistence

- \`src/features/inventory/domain/types.ts\`: catalog, variant, document, balance, and snapshot types.
- \`src/features/inventory/domain/validation.ts\`: Zod input schemas and cross-line rules.
- \`src/features/inventory/domain/post-document.ts\`: pure atomic document projection.
- \`src/features/inventory/domain/selectors.ts\`: dashboard totals, low-stock list, search, and filters.
- \`src/features/inventory/data/inventory-repository.ts\`: persistence contract.
- \`src/features/inventory/data/demo-repository.ts\`: versioned localStorage implementation.
- \`src/features/inventory/data/supabase-repository.ts\`: RPC-backed Supabase implementation.
- \`src/features/inventory/data/repository-factory.ts\`: environment-based repository selection.
- \`src/features/inventory/data/seed.ts\`: initial catalog and demo balances.
- \`src/features/inventory/inventory-provider.tsx\`: loading, mutation, refresh, and error state.

### Shared UI

- \`src/components/app-shell.tsx\`: responsive sidebar/mobile navigation.
- \`src/components/ui/*\`: button, field, select, modal, toast, empty state, and status badge primitives.
- \`src/features/inventory/components/document-line-editor.tsx\`: reusable multi-line variant editor.
- \`src/features/inventory/components/document-form.tsx\`: shared date/reference/note and submission frame.
- \`src/features/inventory/components/stock-status.tsx\`: stock quantity and low-stock treatment.

### Database and verification

- \`supabase/migrations/202607220001_inventory.sql\`: schema, constraints, indexes, RLS, seed, and \`post_stock_document\` RPC.
- \`.env.example\`: Supabase mode configuration.
- \`tests/unit/*\`: domain and repository tests.
- \`tests/components/*\`: workflow and responsive component tests.
- \`tests/e2e/inventory.spec.ts\`: core Playwright smoke test.

---

### Task 1: Project Foundation and Domain Contracts

**Files:**
- Create: \`package.json\`, \`tsconfig.json\`, \`next.config.ts\`, \`postcss.config.mjs\`, \`eslint.config.mjs\`
- Create: \`src/app/globals.css\`, \`src/app/layout.tsx\`, \`src/app/page.tsx\`
- Create: \`vitest.config.ts\`, \`vitest.setup.ts\`
- Create: \`src/features/inventory/domain/types.ts\`
- Create: \`src/features/inventory/domain/validation.ts\`
- Test: \`tests/unit/validation.test.ts\`

**Interfaces:**
- Produces: \`StockDocumentInput\`, \`StockDocumentLineInput\`, \`InventorySnapshot\`, \`validateDocument(input)\`
- Consumes: no application interfaces

- [ ] **Step 1: Install the runtime and test harness**

Run:

~~~powershell
npm init -y
npm install next@latest react@latest react-dom@latest zod @supabase/supabase-js lucide-react
npm install -D typescript @types/node @types/react @types/react-dom tailwindcss @tailwindcss/postcss eslint eslint-config-next vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @vitejs/plugin-react playwright
npm pkg set scripts.dev="next dev" scripts.build="next build" scripts.start="next start" scripts.lint="eslint ." scripts.test="vitest run" scripts.test:watch="vitest" scripts.typecheck="tsc --noEmit" scripts.e2e="playwright test"
~~~

Expected: dependencies install successfully and package scripts resolve.

- [ ] **Step 2: Write a failing validation test**

Create \`tests/unit/validation.test.ts\`:

~~~ts
import { describe, expect, it } from "vitest";
import { validateDocument } from "@/features/inventory/domain/validation";

describe("validateDocument", () => {
  it("accepts decimal sizes and multiple positive receipt lines", () => {
    const result = validateDocument({
      type: "RECEIPT",
      effectiveDate: "2026-07-22",
      reference: "PO-1001",
      note: "",
      lines: [
        { variantId: "paris-black-38.5", size: 38.5, quantity: 5 },
        { variantId: "paris-black-39", size: 39, quantity: 3 },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects duplicate variants and fractional pair quantities", () => {
    const result = validateDocument({
      type: "RECEIPT",
      effectiveDate: "2026-07-22",
      reference: "",
      note: "",
      lines: [
        { variantId: "paris-black-38.5", size: 38.5, quantity: 1.5 },
        { variantId: "paris-black-38.5", size: 38.5, quantity: 2 },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "INVALID_QUANTITY" }),
          expect.objectContaining({ code: "DUPLICATE_VARIANT" }),
        ]),
      );
    }
  });
});
~~~

- [ ] **Step 3: Run the test and verify RED**

Run: \`npm test -- tests/unit/validation.test.ts\`

Expected: FAIL because \`@/features/inventory/domain/validation\` does not exist.

- [ ] **Step 4: Create focused domain types and minimal validation**

Define these exact public types in \`types.ts\`:

~~~ts
export type MovementType =
  | "RECEIPT"
  | "SALE"
  | "DAMAGE"
  | "ADJUSTMENT"
  | "EXCHANGE";

export interface ShoeModel {
  id: string;
  name: string;
  active: boolean;
}

export interface Color {
  id: string;
  name: string;
  active: boolean;
}

export interface ProductVariant {
  id: string;
  modelId: string;
  colorId: string;
  size: number;
  lowStockThreshold: number;
  active: boolean;
}

export interface StockDocumentLineInput {
  variantId: string;
  size: number;
  quantity: number;
  direction?: "IN" | "OUT";
  section?: "RETURNED" | "REPLACEMENT";
  note?: string;
}

export interface StockDocumentInput {
  type: MovementType;
  effectiveDate: string;
  reference?: string;
  note?: string;
  lines: StockDocumentLineInput[];
}

export interface StockDocumentLine {
  id: string;
  variantId: string;
  delta: number;
  section?: "RETURNED" | "REPLACEMENT";
  note?: string;
}

export interface StockDocument {
  id: string;
  number: string;
  type: MovementType;
  effectiveDate: string;
  reference: string;
  note: string;
  createdAt: string;
  lines: StockDocumentLine[];
}

export interface InventorySnapshot {
  version: 1;
  models: ShoeModel[];
  colors: Color[];
  variants: ProductVariant[];
  balances: Record<string, number>;
  documents: StockDocument[];
}

export interface ValidationError {
  path: string;
  code: "REQUIRED" | "INVALID_SIZE" | "INVALID_QUANTITY" | "DUPLICATE_VARIANT" | "INVALID_EXCHANGE";
  message: string;
}
~~~

Implement \`validateDocument\` with Zod for positive decimal size, positive integer quantity, ISO date, at least one line, duplicate detection, and exchange section checks. Return \`{ success: true; data }\` or \`{ success: false; errors: ValidationError[] }\`; map messages to Thai.

- [ ] **Step 5: Run foundation verification**

Run:

~~~powershell
npm test -- tests/unit/validation.test.ts
npm run typecheck
npm run lint
~~~

Expected: validation tests PASS; TypeScript and ESLint exit 0.

- [ ] **Step 6: Commit**

~~~powershell
git add package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs vitest.config.ts vitest.setup.ts src tests/unit/validation.test.ts
git commit -m "feat: establish inventory domain foundation"
~~~

---

### Task 2: Atomic Ledger Projection and Demo Repository

**Files:**
- Create: \`src/features/inventory/domain/post-document.ts\`
- Create: \`src/features/inventory/data/seed.ts\`
- Create: \`src/features/inventory/data/inventory-repository.ts\`
- Create: \`src/features/inventory/data/demo-repository.ts\`
- Test: \`tests/unit/post-document.test.ts\`
- Test: \`tests/unit/demo-repository.test.ts\`

**Interfaces:**
- Consumes: \`InventorySnapshot\`, \`StockDocumentInput\`, \`StockDocument\`
- Produces: \`postDocument(snapshot, input, ids)\`, \`InventoryRepository\`, \`DemoInventoryRepository\`, \`createSeedSnapshot()\`

- [ ] **Step 1: Write failing atomicity tests**

Create \`tests/unit/post-document.test.ts\` with three behaviors:

~~~ts
import { describe, expect, it } from "vitest";
import { postDocument } from "@/features/inventory/domain/post-document";
import { createSeedSnapshot } from "@/features/inventory/data/seed";

const ids = {
  documentId: () => "doc-1",
  lineId: (index: number) => "line-" + index,
  documentNumber: () => "STK-20260722-0001",
  now: () => "2026-07-22T10:00:00.000Z",
};

describe("postDocument", () => {
  it("posts every receipt line", () => {
    const seed = createSeedSnapshot();
    const [first, second] = seed.variants;
    const result = postDocument(seed, {
      type: "RECEIPT",
      effectiveDate: "2026-07-22",
      lines: [
        { variantId: first.id, size: first.size, quantity: 5 },
        { variantId: second.id, size: second.size, quantity: 3 },
      ],
    }, ids);
    expect(result.balances[first.id]).toBe(seed.balances[first.id] + 5);
    expect(result.balances[second.id]).toBe(seed.balances[second.id] + 3);
  });

  it("does not mutate any balance when one outgoing line is unavailable", () => {
    const seed = createSeedSnapshot();
    const [first, second] = seed.variants;
    expect(() => postDocument(seed, {
      type: "SALE",
      effectiveDate: "2026-07-22",
      lines: [
        { variantId: first.id, size: first.size, quantity: 1 },
        { variantId: second.id, size: second.size, quantity: 999 },
      ],
    }, ids)).toThrowError("INSUFFICIENT_STOCK");
    expect(seed.balances).toEqual(createSeedSnapshot().balances);
  });

  it("adds the return and removes the replacement in one exchange", () => {
    const seed = createSeedSnapshot();
    const [returned, replacement] = seed.variants;
    const result = postDocument(seed, {
      type: "EXCHANGE",
      effectiveDate: "2026-07-22",
      lines: [
        { variantId: returned.id, size: returned.size, quantity: 1, section: "RETURNED" },
        { variantId: replacement.id, size: replacement.size, quantity: 1, section: "REPLACEMENT" },
      ],
    }, ids);
    expect(result.balances[returned.id]).toBe(seed.balances[returned.id] + 1);
    expect(result.balances[replacement.id]).toBe(seed.balances[replacement.id] - 1);
  });
});
~~~

- [ ] **Step 2: Run tests and verify RED**

Run: \`npm test -- tests/unit/post-document.test.ts\`

Expected: FAIL because projection and seed modules do not exist.

- [ ] **Step 3: Implement signed-line projection without mutation**

\`postDocument\` must:

1. validate the input;
2. copy balances before calculation;
3. convert receipt lines to positive deltas;
4. convert sale/damage lines to negative deltas;
5. use explicit direction for adjustment;
6. convert exchange return lines to positive and replacement lines to negative;
7. reject missing variants and any projected negative balance;
8. append one immutable document only after every line is valid.

Define:

~~~ts
export interface DocumentIdFactory {
  documentId(): string;
  lineId(index: number): string;
  documentNumber(): string;
  now(): string;
}

export function postDocument(
  snapshot: InventorySnapshot,
  input: StockDocumentInput,
  ids: DocumentIdFactory,
): InventorySnapshot;
~~~

Seed all nine specified model-color combinations with sizes \`38\`, \`38.5\`, \`39\`, \`40\`, \`41\`, \`42\`, and \`43.5\`, deterministic IDs, demo balances, and a threshold of 3.

- [ ] **Step 4: Verify projection GREEN**

Run: \`npm test -- tests/unit/post-document.test.ts\`

Expected: all three atomicity tests PASS.

- [ ] **Step 5: Write failing repository contract tests**

Define the repository interface:

~~~ts
export interface InventoryRepository {
  load(): Promise<InventorySnapshot>;
  postDocument(input: StockDocumentInput): Promise<StockDocument>;
  saveLowStockThreshold(variantId: string, threshold: number): Promise<void>;
  addModel(name: string): Promise<ShoeModel>;
  renameModel(id: string, name: string): Promise<void>;
  setModelActive(id: string, active: boolean): Promise<void>;
  addColor(name: string): Promise<Color>;
  renameColor(id: string, name: string): Promise<void>;
  setColorActive(id: string, active: boolean): Promise<void>;
}
~~~

In \`demo-repository.test.ts\`, use an in-memory \`Storage\` implementation and verify initial seed, persistence across repository instances, case-insensitive duplicate catalog rejection, deactivation, threshold validation, and failed-document atomicity.

- [ ] **Step 6: Run repository tests and verify RED**

Run: \`npm test -- tests/unit/demo-repository.test.ts\`

Expected: FAIL because \`DemoInventoryRepository\` does not exist.

- [ ] **Step 7: Implement versioned localStorage persistence**

Use storage key \`sole-stock.inventory.v1\`. Load only snapshots with \`version: 1\`; invalid JSON or incompatible versions fall back to a fresh seed without overwriting until the next successful mutation. Every mutation calculates a complete next snapshot first, persists it once, then publishes the new in-memory value. Normalize catalog names with \`trim().toLocaleLowerCase("en-US")\`.

- [ ] **Step 8: Run all domain and repository tests**

Run: \`npm test -- tests/unit\`

Expected: all unit tests PASS with no console warnings.

- [ ] **Step 9: Commit**

~~~powershell
git add src/features/inventory/domain src/features/inventory/data tests/unit
git commit -m "feat: add atomic inventory ledger and demo persistence"
~~~

---

### Task 3: Selectors, Repository Factory, and Client Provider

**Files:**
- Create: \`src/features/inventory/domain/selectors.ts\`
- Create: \`src/features/inventory/data/repository-factory.ts\`
- Create: \`src/features/inventory/inventory-provider.tsx\`
- Test: \`tests/unit/selectors.test.ts\`
- Test: \`tests/components/inventory-provider.test.tsx\`

**Interfaces:**
- Consumes: \`InventoryRepository\`, \`InventorySnapshot\`
- Produces: \`selectDashboardSummary\`, \`selectLowStock\`, \`filterInventory\`, \`InventoryProvider\`, \`useInventory()\`

- [ ] **Step 1: Write failing selector tests**

Cover current-month receipt/issue totals, total on-hand pairs, low stock where \`quantity <= threshold\`, inactive variant exclusion, case-insensitive model/color search, decimal-size search, and model/color/status filters.

Use this public filter type:

~~~ts
export interface InventoryFilters {
  query: string;
  modelId: string | null;
  colorId: string | null;
  status: "ALL" | "LOW" | "OUT";
}
~~~

- [ ] **Step 2: Verify selector RED**

Run: \`npm test -- tests/unit/selectors.test.ts\`

Expected: FAIL because selector module does not exist.

- [ ] **Step 3: Implement pure selectors**

Return joined inventory rows shaped as:

~~~ts
export interface InventoryRow {
  variantId: string;
  modelName: string;
  colorName: string;
  size: number;
  quantity: number;
  lowStockThreshold: number;
  status: "NORMAL" | "LOW" | "OUT";
}
~~~

Sort rows by model name, color name, then numeric size. Count negative deltas as issued pairs and positive receipt deltas as received pairs; exchange lines do not inflate monthly receipt/issue KPI totals.

- [ ] **Step 4: Write provider tests and verify RED**

Test loading, successful refresh after posting, retained form-independent snapshot after repository error, Thai error copy, and demo-mode indicator. Inject the repository through an optional \`repository\` prop so tests use a real in-memory implementation without mocking domain logic.

Run: \`npm test -- tests/components/inventory-provider.test.tsx\`

Expected: FAIL because provider does not exist.

- [ ] **Step 5: Implement provider and repository factory**

\`createInventoryRepository()\` returns Supabase only when all three values are true: \`NEXT_PUBLIC_INVENTORY_BACKEND === "supabase"\`, a URL exists, and an anonymous key exists. Otherwise it returns \`DemoInventoryRepository(window.localStorage)\`.

\`useInventory()\` returns:

~~~ts
interface InventoryContextValue {
  snapshot: InventorySnapshot | null;
  loading: boolean;
  mode: "demo" | "supabase";
  error: string | null;
  refresh(): Promise<void>;
  postDocument(input: StockDocumentInput): Promise<StockDocument>;
  saveLowStockThreshold(variantId: string, threshold: number): Promise<void>;
  catalog: Pick<InventoryRepository,
    "addModel" | "renameModel" | "setModelActive" |
    "addColor" | "renameColor" | "setColorActive">;
}
~~~

- [ ] **Step 6: Verify provider and selectors**

Run:

~~~powershell
npm test -- tests/unit/selectors.test.ts tests/components/inventory-provider.test.tsx
npm run typecheck
~~~

Expected: tests PASS and typecheck exits 0.

- [ ] **Step 7: Commit**

~~~powershell
git add src/features/inventory tests/unit/selectors.test.ts tests/components/inventory-provider.test.tsx
git commit -m "feat: expose inventory state and reporting selectors"
~~~

---

### Task 4: Responsive Shell, Dashboard, and Inventory

**Files:**
- Modify: \`src/app/layout.tsx\`, \`src/app/page.tsx\`, \`src/app/globals.css\`
- Create: \`src/app/inventory/page.tsx\`
- Create: \`src/components/app-shell.tsx\`
- Create: \`src/components/ui/button.tsx\`, \`field.tsx\`, \`select.tsx\`, \`modal.tsx\`, \`toast.tsx\`, \`empty-state.tsx\`, \`status-badge.tsx\`
- Create: \`src/features/inventory/components/stock-status.tsx\`
- Test: \`tests/components/app-shell.test.tsx\`
- Test: \`tests/components/dashboard.test.tsx\`
- Test: \`tests/components/inventory-page.test.tsx\`

**Interfaces:**
- Consumes: \`useInventory\`, reporting selectors
- Produces: responsive navigation, dashboard quick actions, stock search/filter/threshold UI

- [ ] **Step 1: Write shell and dashboard tests**

Assert Thai navigation labels, links to all seven routes, demo-mode badge, KPI labels, low-stock rows, recent movement rows, and quick-action destinations. Assert navigation has accessible names and the active link uses \`aria-current="page"\`.

- [ ] **Step 2: Verify UI RED**

Run: \`npm test -- tests/components/app-shell.test.tsx tests/components/dashboard.test.tsx\`

Expected: FAIL because UI components do not exist.

- [ ] **Step 3: Implement the Operations Dashboard visual system**

Use the approved direction: dark forest sidebar \`#183B2F\`, green actions \`#237B58\`, warm orange emphasis \`#E77C45\`, warm off-white canvas, rounded cards, strong numeric hierarchy, and Thai system font fallback. At \`min-width: 768px\`, show the sidebar. Below 768 px, hide it and show a fixed bottom navigation with a safe-area inset.

The dashboard must render:

- \`สินค้าคงเหลือ\`
- \`รับเข้าเดือนนี้\`
- \`นำออกเดือนนี้\`
- \`สต๊อกต่ำ\`
- quick actions \`รับสินค้า\`, \`นำสินค้าออก\`, \`เปลี่ยนสินค้า\`
- \`สินค้าที่ต้องเติม\`
- \`รายการล่าสุด\`

- [ ] **Step 4: Write inventory page tests**

Assert search by \`38.5\`, filtering to low stock, desktop table headers, mobile card content, an empty state, and threshold validation rejecting negative or fractional values.

- [ ] **Step 5: Verify inventory RED**

Run: \`npm test -- tests/components/inventory-page.test.tsx\`

Expected: FAIL because inventory page does not exist.

- [ ] **Step 6: Implement inventory page**

Keep filters in local component state. Render one semantic table that is visually hidden below 768 px and one card list hidden at 768 px and above. The same filtered \`InventoryRow[]\` feeds both representations. Threshold edit uses an accessible modal, integer input with minimum 0, save/cancel buttons, inline Thai error, and success toast.

- [ ] **Step 7: Verify UI**

Run:

~~~powershell
npm test -- tests/components/app-shell.test.tsx tests/components/dashboard.test.tsx tests/components/inventory-page.test.tsx
npm run typecheck
npm run lint
~~~

Expected: all listed tests PASS; typecheck and lint exit 0.

- [ ] **Step 8: Commit**

~~~powershell
git add src/app src/components src/features/inventory/components tests/components
git commit -m "feat: build responsive stock dashboard and inventory"
~~~

---

### Task 5: Receipt, Issue, and Exchange Workflows

**Files:**
- Create: \`src/app/receive/page.tsx\`
- Create: \`src/app/issue/page.tsx\`
- Create: \`src/app/exchange/page.tsx\`
- Create: \`src/features/inventory/components/document-form.tsx\`
- Create: \`src/features/inventory/components/document-line-editor.tsx\`
- Create: \`src/features/inventory/components/exchange-preview.tsx\`
- Create: \`src/features/inventory/hooks/use-unsaved-changes.ts\`
- Test: \`tests/components/receive-page.test.tsx\`
- Test: \`tests/components/issue-page.test.tsx\`
- Test: \`tests/components/exchange-page.test.tsx\`

**Interfaces:**
- Consumes: \`useInventory().postDocument\`, active models/colors/variants
- Produces: valid \`StockDocumentInput\` commands for all movement workflows

- [ ] **Step 1: Write receipt workflow tests**

Test adding/removing rows, selecting model/color/size, decimal size display, duplicate-row error, positive whole quantity validation, preservation after repository failure, and successful Thai confirmation containing the generated document number.

- [ ] **Step 2: Verify receipt RED**

Run: \`npm test -- tests/components/receive-page.test.tsx\`

Expected: FAIL because receipt workflow does not exist.

- [ ] **Step 3: Implement shared form and receipt**

\`DocumentForm\` owns effective date, reference, note, submit state, repository-error banner, and unsaved-change registration. \`DocumentLineEditor\` receives \`section\`, \`lines\`, \`onChange\`, \`variants\`, and \`showAvailable\`; it uses stable row IDs and prevents selecting a variant already used in that section. Submit a \`RECEIPT\` command only after \`validateDocument\` succeeds.

- [ ] **Step 4: Write issue tests and verify RED**

Test required reason, SALE and DAMAGE negative posting, ADJUSTMENT direction selection, available quantity display, blocked excessive outgoing quantity, and multiple lines.

Run: \`npm test -- tests/components/issue-page.test.tsx\`

Expected: FAIL because issue page does not exist.

- [ ] **Step 5: Implement issue workflow**

Map reason labels:

- \`ขาย\` to \`SALE\`
- \`ชำรุด\` to \`DAMAGE\`
- \`ปรับยอด\` to \`ADJUSTMENT\`

For adjustment, require \`เพิ่มยอด\` or \`ลดยอด\` and set each line direction to \`IN\` or \`OUT\`. Show current on-hand quantity for every selected row and reject outgoing quantity above it before calling the repository.

- [ ] **Step 6: Write exchange tests and verify RED**

Test that both sections are required, returned lines preview positive changes, replacement lines preview negative changes, insufficient replacement stock blocks submission, and a successful submission calls the repository once with one \`EXCHANGE\` command.

Run: \`npm test -- tests/components/exchange-page.test.tsx\`

Expected: FAIL because exchange page does not exist.

- [ ] **Step 7: Implement exchange workflow**

Render returned and replacement panels side by side at desktop widths and stacked on mobile. Use independent line editors, then combine them into one command with \`section: "RETURNED"\` and \`section: "REPLACEMENT"\`. Show a confirmation modal listing signed changes before the single repository call.

- [ ] **Step 8: Verify all workflows**

Run:

~~~powershell
npm test -- tests/components/receive-page.test.tsx tests/components/issue-page.test.tsx tests/components/exchange-page.test.tsx
npm run typecheck
npm run lint
~~~

Expected: all workflow tests PASS; typecheck and lint exit 0.

- [ ] **Step 9: Commit**

~~~powershell
git add src/app/receive src/app/issue src/app/exchange src/features/inventory/components src/features/inventory/hooks tests/components
git commit -m "feat: add inventory movement workflows"
~~~

---

### Task 6: Movement History and Catalog Management

**Files:**
- Create: \`src/app/history/page.tsx\`
- Create: \`src/app/catalog/page.tsx\`
- Create: \`src/features/inventory/domain/history.ts\`
- Test: \`tests/unit/history.test.ts\`
- Test: \`tests/components/history-page.test.tsx\`
- Test: \`tests/components/catalog-page.test.tsx\`

**Interfaces:**
- Consumes: immutable documents and repository catalog methods
- Produces: searchable history rows, document detail UI, active/deactivated model and color controls

- [ ] **Step 1: Write history selector tests**

Test date-range inclusion, type filter, document/reference search, joined model/color/size search, newest-first ordering, and signed total calculation.

- [ ] **Step 2: Verify history RED**

Run: \`npm test -- tests/unit/history.test.ts\`

Expected: FAIL because history selector does not exist.

- [ ] **Step 3: Implement history selector and page tests**

Return:

~~~ts
export interface HistoryRow {
  documentId: string;
  number: string;
  type: MovementType;
  effectiveDate: string;
  reference: string;
  lineCount: number;
  pairMovement: number;
}
~~~

Component tests assert Thai type labels, filters, empty state, and immutable detail dialog with every signed line.

- [ ] **Step 4: Implement history page and verify GREEN**

Run: \`npm test -- tests/unit/history.test.ts tests/components/history-page.test.tsx\`

Expected: tests PASS.

- [ ] **Step 5: Write catalog tests and verify RED**

Test adding, renaming, duplicate-name error, deactivating, reactivating, and preventing a page-level delete action. Verify initial Paris, Castor, Weave and their specified colors are visible.

Run: \`npm test -- tests/components/catalog-page.test.tsx\`

Expected: FAIL because catalog page does not exist.

- [ ] **Step 6: Implement catalog management**

Use separate model and color cards. Active rows expose rename/deactivate; inactive rows expose reactivate. Confirm deactivation in a modal, retain referenced variants, trim names, and show repository validation messages in Thai.

- [ ] **Step 7: Verify history and catalog**

Run:

~~~powershell
npm test -- tests/unit/history.test.ts tests/components/history-page.test.tsx tests/components/catalog-page.test.tsx
npm run typecheck
npm run lint
~~~

Expected: all tests PASS; typecheck and lint exit 0.

- [ ] **Step 8: Commit**

~~~powershell
git add src/app/history src/app/catalog src/features/inventory/domain/history.ts tests
git commit -m "feat: add movement history and catalog management"
~~~

---

### Task 7: Supabase PostgreSQL Schema and Repository

**Files:**
- Create: \`supabase/migrations/202607220001_inventory.sql\`
- Create: \`src/lib/supabase.ts\`
- Create: \`src/features/inventory/data/supabase-repository.ts\`
- Create: \`.env.example\`
- Test: \`tests/unit/repository-factory.test.ts\`
- Test: \`tests/unit/supabase-mapping.test.ts\`

**Interfaces:**
- Consumes: \`InventoryRepository\`, \`StockDocumentInput\`
- Produces: \`SupabaseInventoryRepository\`, \`post_stock_document(jsonb)\`, database rows mapped to \`InventorySnapshot\`

- [ ] **Step 1: Write repository-selection and mapping tests**

Assert demo mode when configuration is absent, demo mode when only one Supabase value exists, Supabase mode only when backend flag/URL/key are all set, movement line mapping, decimal size numeric conversion, and Thai mapping for PostgreSQL error code \`P0001\` with message \`INSUFFICIENT_STOCK\`.

- [ ] **Step 2: Verify Supabase RED**

Run: \`npm test -- tests/unit/repository-factory.test.ts tests/unit/supabase-mapping.test.ts\`

Expected: FAIL because Supabase implementation does not exist.

- [ ] **Step 3: Write the SQL migration**

Create tables with UUID primary keys, case-insensitive unique name indexes using \`lower(name)\`, \`numeric(4,1)\` size with \`size > 0\`, integer quantities, non-negative balance checks, movement-type checks, exchange-section checks, timestamps, and indexes on document date/type and line variant.

Implement \`post_stock_document(command jsonb) returns uuid\` as \`security invoker\`:

1. validate document metadata and non-empty lines;
2. lock all affected balance rows in sorted variant-ID order;
3. derive signed deltas from movement type and exchange section;
4. aggregate repeated variant deltas before balance checks;
5. raise \`INSUFFICIENT_STOCK\` if any projected balance is negative;
6. insert one document and all lines;
7. upsert every balance;
8. return the document UUID.

Enable RLS. Add explicit anonymous read/write policies labeled for the shared version-one client, with comments warning that authentication must replace them before sensitive or multi-tenant deployment. Seed models and colors idempotently.

- [ ] **Step 4: Implement Supabase client and repository**

\`src/lib/supabase.ts\` exports a client factory that accepts URL/key arguments rather than reading environment variables at module import time. Repository \`load()\` fetches catalog, variants, balances, documents, and lines; maps numeric strings to numbers; groups lines under documents; and returns \`version: 1\`. Mutations call the RPC or catalog table operations and then rely on provider refresh.

- [ ] **Step 5: Verify Supabase mapping and selection GREEN**

Run:

~~~powershell
npm test -- tests/unit/repository-factory.test.ts tests/unit/supabase-mapping.test.ts
npm run typecheck
npm run lint
~~~

Expected: tests PASS; typecheck and lint exit 0.

- [ ] **Step 6: Document environment variables**

\`.env.example\` must contain:

~~~dotenv
NEXT_PUBLIC_INVENTORY_BACKEND=demo
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
~~~

Add comments in the repository README explaining that \`demo\` is the default and \`supabase\` requires applying the migration before switching the flag.

- [ ] **Step 7: Commit**

~~~powershell
git add supabase src/lib src/features/inventory/data .env.example README.md tests/unit
git commit -m "feat: add Supabase inventory persistence"
~~~

---

### Task 8: End-to-End Responsive Verification and Release Polish

**Files:**
- Create: \`playwright.config.ts\`
- Create: \`tests/e2e/inventory.spec.ts\`
- Modify: \`README.md\`
- Modify: \`src/app/globals.css\` and affected components only when verification exposes a defect

**Interfaces:**
- Consumes: complete application in demo mode
- Produces: verified mobile/desktop workflows and setup documentation

- [ ] **Step 1: Write failing Playwright smoke test**

The test must:

1. start with clean localStorage;
2. verify seeded Dashboard at 1440 by 900;
3. receive two variants in one document;
4. issue one pair as a sale;
5. exchange one returned pair for one replacement pair;
6. confirm the three documents appear in history;
7. confirm resulting balances in inventory;
8. repeat navigation and open each workflow at 390 by 844;
9. assert no horizontal document overflow and primary controls are visible.

- [ ] **Step 2: Verify E2E RED**

Run: \`npm run e2e -- tests/e2e/inventory.spec.ts\`

Expected: FAIL until Playwright configuration, stable selectors, and any uncovered UI details are complete.

- [ ] **Step 3: Add Playwright configuration and minimal fixes**

Configure \`webServer.command\` as \`npm run dev\`, reuse no existing server in CI, use Chromium, capture screenshots only on failure, and set demo backend through the web-server environment. Add stable accessible names or \`data-testid\` only where role/name selection cannot identify a repeated row control.

- [ ] **Step 4: Run full automated verification**

Run:

~~~powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run e2e
~~~

Expected: all tests PASS, typecheck/lint exit 0, production build succeeds, and Playwright passes desktop and mobile projects.

- [ ] **Step 5: Perform visual verification**

Open Dashboard, Inventory, Receive, Issue, Exchange, History, and Catalog at 390 by 844 and 1440 by 900. Verify no clipped Thai text, no horizontal overflow, visible focus, readable low-stock status without relying only on color, 44 px touch targets, bottom navigation clear of safe-area inset, and sidebar content clear of the viewport edge.

- [ ] **Step 6: Complete README**

Document prerequisites, \`npm install\`, \`npm run dev\`, demo persistence/reset behavior, all test commands, Supabase migration application, environment switching, the no-auth limitation, and a concise route map.

- [ ] **Step 7: Final verification after documentation and polish**

Run:

~~~powershell
git diff --check
npm test
npm run typecheck
npm run lint
npm run build
npm run e2e
git status --short
~~~

Expected: no whitespace errors; all verification passes; only intended files are modified.

- [ ] **Step 8: Commit**

~~~powershell
git add playwright.config.ts tests/e2e README.md src
git commit -m "test: verify responsive inventory workflows"
~~~

---

## Plan Self-Review Result

- Every requirement in the approved design is covered by Tasks 1–8.
- Domain, repository, UI, database, and end-to-end interfaces use the same movement names and signed-line semantics.
- No production domain behavior is introduced before its failing test.
- Generated project configuration and dependency installation are isolated in Task 1; feature behavior begins with RED tests.
- Supabase mode remains opt-in and demo mode remains the zero-configuration default.
- Authentication, multiple warehouses, pricing, purchasing, barcode scanning, and approvals remain outside this plan.
