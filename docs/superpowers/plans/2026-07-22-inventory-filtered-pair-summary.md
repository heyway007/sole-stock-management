# Inventory Filtered Pair Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the number of matching inventory variants and their combined on-hand pairs in the inventory header.

**Architecture:** Continue using `filterInventory(snapshot, filters)` as the source of visible rows, then derive the pair total from those rows inside the inventory page. Render both values in one accessible responsive summary group and reuse the existing count-card styling.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS, Vitest, Testing Library, Playwright

## Global Constraints

- Both summary values must follow the current search, model, color, and stock-status filters.
- The empty result must show `0 รายการ` and `0 คู่`.
- Do not change inventory persistence, filtering rules, table/card contents, or application behavior outside the header summary.
- Keep both summary cards together and right-aligned without horizontal overflow on narrow screens.
- Preserve the existing uncommitted `next-env.d.ts` change and do not stage it.

---

### Task 1: Add the filtered inventory pair summary

**Files:**
- Modify: `tests/components/inventory-page.test.tsx`
- Modify: `src/app/inventory/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `rows: InventoryRow[]` returned by `filterInventory(snapshot, filters)`.
- Produces: `totalPairs: number` and an accessible `role="group"` named `สรุปสินค้าคงคลัง` containing the filtered `รายการ` and `คู่` values.

- [ ] **Step 1: Write the failing component test**

Add this test inside the existing `describe("InventoryPage", ...)` block in `tests/components/inventory-page.test.tsx`:

```tsx
it("summarizes matching variants and pairs as filters change", async () => {
  const user = userEvent.setup();
  renderInventory();

  const summary = await screen.findByRole("group", { name: "สรุปสินค้าคงคลัง" });
  expect(within(summary).getByText("63")).toBeInTheDocument();
  expect(within(summary).getByText("773")).toBeInTheDocument();
  expect(within(summary).getByText("รายการ")).toBeInTheDocument();
  expect(within(summary).getByText("คู่")).toBeInTheDocument();

  await user.selectOptions(screen.getByRole("combobox", { name: "รุ่นสินค้า" }), "castor");
  await user.selectOptions(screen.getByRole("combobox", { name: "สีสินค้า" }), "brown");
  expect(within(summary).getByText("7")).toBeInTheDocument();
  expect(within(summary).getByText("83")).toBeInTheDocument();

  await user.type(screen.getByRole("searchbox", { name: "ค้นหาสินค้า" }), "ไม่มีสินค้านี้");
  expect(within(summary).getAllByText("0")).toHaveLength(2);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- tests/components/inventory-page.test.tsx
```

Expected: FAIL because no accessible group named `สรุปสินค้าคงคลัง` exists yet.

- [ ] **Step 3: Derive and render the filtered pair total**

In `src/app/inventory/page.tsx`, derive the quantity total immediately after `rows`:

```tsx
const rows = useMemo(() => snapshot ? filterInventory(snapshot, filters) : [], [filters, snapshot]);
const totalPairs = useMemo(() => rows.reduce((total, row) => total + row.quantity, 0), [rows]);
```

Replace the single count element in the inventory header with this summary group:

```tsx
<div className="inventory-summary" role="group" aria-label="สรุปสินค้าคงคลัง">
  <span className="inventory-count"><strong>{rows.length}</strong><small>รายการ</small></span>
  <span className="inventory-count"><strong>{totalPairs}</strong><small>คู่</small></span>
</div>
```

- [ ] **Step 4: Keep the two cards responsive and right-aligned**

Update the inventory summary rules in `src/app/globals.css`:

```css
.inventory-header { align-items: center; flex-wrap: wrap; }
.inventory-summary { display: flex; flex-shrink: 0; gap: 10px; margin-left: auto; }
.inventory-count { min-width: 72px; display: flex; flex-direction: column; align-items: center; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); padding: 10px 14px; box-shadow: var(--shadow); }
.inventory-count strong { font-size: 1.35rem; line-height: 1.1; }
.inventory-count small { color: var(--muted); }
```

Add this narrow-screen rule before the existing `@media (min-width: 560px)` block:

```css
@media (max-width: 559px) {
  .inventory-header > div:first-child { min-width: 0; flex: 1 1 100%; }
  .inventory-summary { width: 100%; justify-content: flex-end; }
}
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```powershell
npm test -- tests/components/inventory-page.test.tsx
```

Expected: all inventory page component tests pass, including totals `63 / 773`, filtered totals `7 / 83`, and empty totals `0 / 0`.

- [ ] **Step 6: Run all regression checks**

Run:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run e2e -- tests/e2e/inventory.spec.ts
```

Expected: all Vitest tests, TypeScript, ESLint, and the production build pass. Playwright passes at 1440×900, 390×844, and 360×800 without horizontal overflow.

- [ ] **Step 7: Review and commit only the summary implementation files**

Run:

```powershell
git diff --check
git status --short
git add src/app/inventory/page.tsx src/app/globals.css tests/components/inventory-page.test.tsx
git diff --cached --check
git commit -m "feat: show filtered inventory pair total"
```

Expected: the commit contains only the three implementation/test files. `next-env.d.ts` remains unstaged.
