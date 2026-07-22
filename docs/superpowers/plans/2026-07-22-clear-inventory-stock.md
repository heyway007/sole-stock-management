# Clear Inventory Stock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a SweetAlert2-guarded action that atomically clears every inventory balance while preserving catalog data and recording one adjustment document.

**Architecture:** Extend the repository/provider contract with `clearStock(effectiveDate)`. Demo mode derives one adjustment document under its existing mutation lock; Supabase delegates to a new security-definer RPC that locks all balances and reuses `post_stock_document` for audited atomic updates. A focused client component owns SweetAlert2 confirmation while the inventory page supplies global, filter-independent totals.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, SweetAlert2, Supabase PostgreSQL RPC, Vitest, Testing Library, Playwright

## Global Constraints

- Clear the entire inventory regardless of search or active filters.
- Preserve models, colors, variants, thresholds, and all previous stock documents.
- Create one `ADJUSTMENT` document with reference `CLEAR-STOCK`, note `ล้างสต๊อกทั้งคลัง`, and exact negative deltas for positive balances.
- Do not create a document when all balances are already zero.
- Require the exact case- and whitespace-sensitive phrase `ล้างสต๊อก` in SweetAlert2.
- Keep the action available to all users; do not add authentication or roles.
- Use deterministic balance locking and one transaction so partial clears are impossible.
- Preserve the existing uncommitted `next-env.d.ts` change and do not stage it.

---

### Task 1: Add the repository clear-stock contract

**Files:**
- Modify: `src/features/inventory/data/inventory-repository.ts`
- Modify: `src/features/inventory/data/demo-repository.ts`
- Modify: `src/features/inventory/data/supabase-repository.ts`
- Modify: `src/lib/supabase.ts`
- Test: `tests/unit/demo-repository.test.ts`
- Test: `tests/unit/supabase-repository.test.ts`

**Interfaces:**
- Produces: `InventoryRepository.clearStock(effectiveDate: string): Promise<StockDocument | null>`.
- Produces: Supabase function contract `clear_inventory_stock({ command: Json }): Json`.
- Consumes: existing `postDocument`, `postedDocument`, `throwFor`, and repository mutation locking.

- [ ] **Step 1: Write failing demo repository assertions**

Add this test inside `describe("DemoInventoryRepository", ...)` in `tests/unit/demo-repository.test.ts`:

```ts
it("clears every positive balance in one audited adjustment and keeps the catalog", async () => {
  const repository = new DemoInventoryRepository(new MemoryStorage());
  const seeded = await repository.load();
  const firstVariant = seeded.variants[0];
  await repository.postDocument({
    type: "RECEIPT",
    effectiveDate: "2026-07-21",
    reference: "BEFORE-CLEAR",
    lines: [{ variantId: firstVariant.id, size: firstVariant.size, quantity: 1 }],
  });
  const before = await repository.load();
  const totalBefore = Object.values(before.balances).reduce((total, quantity) => total + quantity, 0);

  const cleared = await repository.clearStock("2026-07-22");
  const after = await repository.load();

  expect(cleared).toMatchObject({
    type: "ADJUSTMENT",
    effectiveDate: "2026-07-22",
    reference: "CLEAR-STOCK",
    note: "ล้างสต๊อกทั้งคลัง",
  });
  expect(cleared?.lines.reduce((total, line) => total + line.delta, 0)).toBe(-totalBefore);
  expect(cleared?.lines.every((line) => line.delta < 0)).toBe(true);
  expect(Object.values(after.balances).every((quantity) => quantity === 0)).toBe(true);
  expect(after.models).toEqual(before.models);
  expect(after.colors).toEqual(before.colors);
  expect(after.variants).toEqual(before.variants);
  expect(after.documents.slice(0, -1)).toEqual(before.documents);
  expect(after.documents.at(-1)).toEqual(cleared);

  await expect(repository.clearStock("2026-07-22")).resolves.toBeNull();
  expect((await repository.load()).documents).toEqual(after.documents);
});
```

- [ ] **Step 2: Write failing Supabase repository assertions**

Add an adjustment response helper and these tests to `tests/unit/supabase-repository.test.ts`:

```ts
function clearedDocument(): StockDocument {
  return {
    id: "clear-document",
    number: "STK-20260722-000010",
    type: "ADJUSTMENT",
    effectiveDate: "2026-07-22",
    reference: "CLEAR-STOCK",
    note: "ล้างสต๊อกทั้งคลัง",
    createdAt: "2026-07-22T10:00:00.000Z",
    lines: [{ id: "clear-line", variantId: "variant-1", delta: -7 }],
  };
}

it("clears stock through the dedicated RPC and maps an audited document or null", async () => {
  const client = new ContractClient();
  client.rpcResults.push(
    { data: clearedDocument() as unknown as Json, error: null },
    { data: null, error: null },
  );
  const requestIds = [
    "00000000-0000-4000-8000-000000000041",
    "00000000-0000-4000-8000-000000000042",
  ];
  const repository = new SupabaseInventoryRepository(
    "https://example.supabase.co",
    "anon",
    asClient(client),
    () => requestIds.shift()!,
  );

  await expect(repository.clearStock("2026-07-22")).resolves.toEqual(clearedDocument());
  await expect(repository.clearStock("2026-07-22")).resolves.toBeNull();
  expect(client.rpcCalls).toEqual([
    {
      name: "clear_inventory_stock",
      args: { command: { requestId: "00000000-0000-4000-8000-000000000041", effectiveDate: "2026-07-22" } },
    },
    {
      name: "clear_inventory_stock",
      args: { command: { requestId: "00000000-0000-4000-8000-000000000042", effectiveDate: "2026-07-22" } },
    },
  ]);
});

it("maps a clear-stock RPC failure to the shared Thai save error", async () => {
  const client = new ContractClient();
  client.rpcResults.push({
    data: null,
    error: { code: "503", message: "network unavailable", details: "", hint: "" },
  });
  const repository = new SupabaseInventoryRepository("https://example.supabase.co", "anon", asClient(client));

  await expect(repository.clearStock("2026-07-22"))
    .rejects.toThrow("ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง");
});
```

- [ ] **Step 3: Run repository tests and verify RED**

Run:

```powershell
npm test -- tests/unit/demo-repository.test.ts tests/unit/supabase-repository.test.ts
```

Expected: TypeScript/test failures because `clearStock` and `clear_inventory_stock` do not exist.

- [ ] **Step 4: Add the interface and Supabase function types**

Add to `InventoryRepository` in `src/features/inventory/data/inventory-repository.ts`:

```ts
clearStock(effectiveDate: string): Promise<StockDocument | null>;
```

Add to `InventoryDatabase["public"]["Functions"]` in `src/lib/supabase.ts`:

```ts
clear_inventory_stock: {
  Args: { command: Json };
  Returns: Json;
};
```

- [ ] **Step 5: Refactor demo posting and implement atomic demo clearing**

Replace the body of `DemoInventoryRepository.postDocument` and add `clearStock`:

```ts
async postDocument(input: StockDocumentInput): Promise<StockDocument> {
  return this.mutate((current) => this.projectDocument(current, input));
}

async clearStock(effectiveDate: string): Promise<StockDocument | null> {
  return this.mutate((current) => {
    const lines = current.variants.flatMap((variant) => {
      const quantity = current.balances[variant.id] ?? 0;
      return quantity > 0
        ? [{ variantId: variant.id, size: variant.size, quantity, direction: "OUT" as const }]
        : [];
    });
    if (lines.length === 0) return { snapshot: current, result: null };

    return this.projectDocument(current, {
      type: "ADJUSTMENT",
      effectiveDate,
      reference: "CLEAR-STOCK",
      note: "ล้างสต๊อกทั้งคลัง",
      lines,
    });
  });
}
```

Add this private method before `readStoredSnapshot` in the same class:

```ts
private projectDocument(current: InventorySnapshot, input: StockDocumentInput) {
  const ordinal = current.documents.length + 1;
  const documentId = this.createId();
  const lineIds = input.lines.map(() => this.createId());
  let next: InventorySnapshot;
  try {
    next = postDocument(current, input, {
      documentId: () => documentId,
      lineId: (index) => lineIds[index],
      documentNumber: () => `STK-${input.effectiveDate.replaceAll("-", "")}-${String(ordinal).padStart(4, "0")}`,
      now: () => new Date().toISOString(),
    });
  } catch (error) {
    throw errorForPost(error);
  }
  const document = next.documents.at(-1)!;
  return {
    snapshot: next,
    result: { ...document, lines: document.lines.map((line) => ({ ...line })) },
  };
}
```

- [ ] **Step 6: Implement the Supabase adapter**

Add this public method to `SupabaseInventoryRepository` after `postDocument`:

```ts
async clearStock(effectiveDate: string): Promise<StockDocument | null> {
  const result = await this.client.rpc("clear_inventory_stock", {
    command: { requestId: this.createRequestId(), effectiveDate },
  });
  throwFor(result.error);
  return result.data === null ? null : postedDocument(result.data);
}
```

- [ ] **Step 7: Run repository tests and verify GREEN**

Run:

```powershell
npm test -- tests/unit/demo-repository.test.ts tests/unit/supabase-repository.test.ts
npm run typecheck
```

Expected: both repository suites and TypeScript pass.

- [ ] **Step 8: Commit the repository contract**

```powershell
git add src/features/inventory/data/inventory-repository.ts src/features/inventory/data/demo-repository.ts src/features/inventory/data/supabase-repository.ts src/lib/supabase.ts tests/unit/demo-repository.test.ts tests/unit/supabase-repository.test.ts
git diff --cached --check
git commit -m "feat: add clear stock repository contract"
```

---

### Task 2: Add the atomic Supabase clear RPC

**Files:**
- Create: `supabase/migrations/202607220003_clear_inventory_stock.sql`
- Modify: `tests/unit/supabase-migration.test.ts`

**Interfaces:**
- Consumes: `public.post_stock_document(command jsonb) returns jsonb`.
- Produces: `public.clear_inventory_stock(command jsonb) returns jsonb` for `anon` and `authenticated`.

- [ ] **Step 1: Write the failing migration contract test**

Add to `tests/unit/supabase-migration.test.ts`:

```ts
it("ships an atomic audited clear-stock RPC with narrow execution grants", () => {
  const clearMigration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/202607220003_clear_inventory_stock.sql"),
    "utf8",
  ).replaceAll("\r\n", "\n").toLocaleLowerCase("en-US");

  expect(clearMigration).toContain("create or replace function public.clear_inventory_stock(command jsonb)");
  expect(clearMigration).toMatch(/from public\.inventory_balances balance[\s\S]*?order by balance\.variant_id[\s\S]*?for update/);
  expect(clearMigration).toContain("where balance.quantity > 0");
  expect(clearMigration).toContain("pg_catalog.pg_advisory_xact_lock");
  expect(clearMigration).toContain("where document.client_request_id = request_id");
  expect(clearMigration).toContain("'clear-stock'");
  expect(clearMigration).toContain("return public.post_stock_document(clear_command);");
  expect(clearMigration).toContain("revoke all on function public.clear_inventory_stock(jsonb) from public, anon, authenticated;");
  expect(clearMigration).toContain("grant execute on function public.clear_inventory_stock(jsonb) to anon, authenticated;");
  expect(clearMigration).not.toMatch(/grant\s+(?:insert|update|delete)\s+on\s+public\./);
});
```

- [ ] **Step 2: Run the migration test and verify RED**

```powershell
npm test -- tests/unit/supabase-migration.test.ts
```

Expected: FAIL with `ENOENT` because migration `202607220003_clear_inventory_stock.sql` does not exist.

- [ ] **Step 3: Create the migration**

Create `supabase/migrations/202607220003_clear_inventory_stock.sql`:

```sql
-- Atomically clear all positive inventory balances while preserving an audit document.

create or replace function public.clear_inventory_stock(command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_id uuid;
  effective_on date;
  clear_lines jsonb;
  clear_command jsonb;
begin
  if command is null or jsonb_typeof(command) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;

  if jsonb_typeof(command -> 'requestId') is distinct from 'string'
    or command ->> 'requestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;
  request_id := (command ->> 'requestId')::uuid;

  if jsonb_typeof(command -> 'effectiveDate') is distinct from 'string'
    or command ->> 'effectiveDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;
  begin
    effective_on := (command ->> 'effectiveDate')::date;
  exception when others then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end;
  if to_char(effective_on, 'YYYY-MM-DD') <> command ->> 'effectiveDate' then
    raise exception using errcode = 'P0001', message = 'INVALID_DOCUMENT';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(request_id::text, 0)
  );

  if exists (
    select 1 from public.stock_documents document
    where document.client_request_id = request_id
  ) then
    return public.post_stock_document(
      pg_catalog.jsonb_build_object('requestId', request_id)
    );
  end if;

  perform balance.variant_id
  from public.inventory_balances balance
  order by balance.variant_id
  for update of balance;

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'variantId', balance.variant_id,
      'size', variant.size,
      'quantity', balance.quantity,
      'direction', 'OUT'
    ) order by balance.variant_id
  )
  into clear_lines
  from public.inventory_balances balance
  join public.product_variants variant on variant.id = balance.variant_id
  where balance.quantity > 0;

  if clear_lines is null then
    return null;
  end if;

  clear_command := pg_catalog.jsonb_build_object(
    'requestId', request_id,
    'type', 'ADJUSTMENT',
    'effectiveDate', to_char(effective_on, 'YYYY-MM-DD'),
    'reference', 'CLEAR-STOCK',
    'note', 'ล้างสต๊อกทั้งคลัง',
    'lines', clear_lines
  );

  return public.post_stock_document(clear_command);
end;
$$;

alter function public.clear_inventory_stock(jsonb) owner to postgres;
revoke all on function public.clear_inventory_stock(jsonb) from public, anon, authenticated;
grant execute on function public.clear_inventory_stock(jsonb) to anon, authenticated;

comment on function public.clear_inventory_stock(jsonb) is
  'Fully open no-login v1 audited inventory clear. Locks every balance and delegates the atomic adjustment to post_stock_document.';
```

- [ ] **Step 4: Run the migration contract and all Supabase unit tests**

```powershell
npm test -- tests/unit/supabase-migration.test.ts tests/unit/supabase-repository.test.ts
```

Expected: both suites pass.

- [ ] **Step 5: Commit the migration**

```powershell
git add supabase/migrations/202607220003_clear_inventory_stock.sql tests/unit/supabase-migration.test.ts
git diff --cached --check
git commit -m "feat: add atomic clear stock RPC"
```

---

### Task 3: Expose clearStock through the inventory provider

**Files:**
- Modify: `src/features/inventory/inventory-provider.tsx`
- Modify: `tests/components/inventory-provider.test.tsx`

**Interfaces:**
- Consumes: `InventoryRepository.clearStock(effectiveDate)` from Task 1.
- Produces: `useInventory().clearStock(effectiveDate): Promise<StockDocument | null>`.

- [ ] **Step 1: Add a failing provider test fixture and assertion**

Add this button to the `InventoryState` fixture in `tests/components/inventory-provider.test.tsx`:

```tsx
{inventory.snapshot && (
  <button onClick={() => void inventory.clearStock("2026-07-22")}>
    ล้างสต๊อกทดสอบ
  </button>
)}
```

Add this test:

```tsx
it("refreshes the snapshot after clearing all stock", async () => {
  render(<InventoryProvider factoryOptions={{ storage: new MemoryStorage() }}><InventoryState /></InventoryProvider>);

  await screen.findByText("จำนวน: 2");
  fireEvent.click(screen.getByRole("button", { name: "ล้างสต๊อกทดสอบ" }));
  expect(await screen.findByText("จำนวน: 0")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused provider test and verify RED**

```powershell
npm test -- tests/components/inventory-provider.test.tsx
```

Expected: FAIL because `InventoryContextValue` has no `clearStock` method.

- [ ] **Step 3: Add the provider mutation**

Add to `InventoryContextValue` in `src/features/inventory/inventory-provider.tsx`:

```ts
clearStock(effectiveDate: string): Promise<StockDocument | null>;
```

Add alongside the other mutation callbacks:

```ts
const clearStock = useCallback(
  (effectiveDate: string) => runMutation((repository) => repository.clearStock(effectiveDate)),
  [runMutation],
);
```

Include `clearStock` in the context value:

```tsx
<InventoryContext value={{ snapshot, loading, mode, error, warning, refresh, postDocument, clearStock, ensureVariant, saveLowStockThreshold, catalog }}>
  {children}
</InventoryContext>
```

- [ ] **Step 4: Run provider tests and verify GREEN**

```powershell
npm test -- tests/components/inventory-provider.test.tsx
npm run typecheck
```

Expected: provider tests and TypeScript pass.

- [ ] **Step 5: Commit provider wiring**

```powershell
git add src/features/inventory/inventory-provider.tsx tests/components/inventory-provider.test.tsx
git diff --cached --check
git commit -m "feat: expose clear stock mutation"
```

---

### Task 4: Build the SweetAlert2 confirmation component

**Files:**
- Create: `src/features/inventory/components/clear-stock-button.tsx`
- Create: `tests/components/clear-stock-button.test.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `onClear(effectiveDate: string): Promise<StockDocument | null>`.
- Produces: `ClearStockButton({ positiveVariants, totalPairs, onClear })`.

- [ ] **Step 1: Install SweetAlert2 locally**

```powershell
npm install sweetalert2
```

Expected: `sweetalert2` is added to dependencies and the lockfile is updated.

- [ ] **Step 2: Write the failing SweetAlert component tests**

Create `tests/components/clear-stock-button.test.tsx`:

```tsx
const { fireMock, showValidationMessageMock, isLoadingMock } = vi.hoisted(() => ({
  fireMock: vi.fn(),
  showValidationMessageMock: vi.fn(),
  isLoadingMock: vi.fn(() => false),
}));

vi.mock("sweetalert2", () => ({
  default: {
    fire: fireMock,
    showValidationMessage: showValidationMessageMock,
    isLoading: isLoadingMock,
  },
}));

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClearStockButton } from "@/features/inventory/components/clear-stock-button";
import type { StockDocument } from "@/features/inventory/domain/types";

type ConfirmationOptions = {
  preConfirm(value: string): Promise<StockDocument | null | false>;
  allowOutsideClick(): boolean;
  allowEscapeKey(): boolean;
};

const clearedDocument: StockDocument = {
  id: "clear-document",
  number: "STK-20260722-000010",
  type: "ADJUSTMENT",
  effectiveDate: "2026-07-22",
  reference: "CLEAR-STOCK",
  note: "ล้างสต๊อกทั้งคลัง",
  createdAt: "2026-07-22T10:00:00.000Z",
  lines: [
    { id: "line-1", variantId: "variant-1", delta: -2 },
    { id: "line-2", variantId: "variant-2", delta: -3 },
  ],
};

describe("ClearStockButton", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    isLoadingMock.mockReturnValue(false);
  });

  it("is disabled when the entire inventory is already zero", () => {
    render(<ClearStockButton positiveVariants={0} totalPairs={0} onClear={vi.fn()} />);
    expect(screen.getByRole("button", { name: "ล้างสต๊อก" })).toBeDisabled();
  });

  it("requires the exact Thai phrase before clearing", async () => {
    const onClear = vi.fn().mockResolvedValue(clearedDocument);
    fireMock.mockResolvedValueOnce({ isConfirmed: false });
    render(<ClearStockButton positiveVariants={2} totalPairs={5} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: "ล้างสต๊อก" }));
    await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(1));

    const options = fireMock.mock.calls[0][0] as ConfirmationOptions;
    await act(async () => {
      await expect(options.preConfirm(" ล้างสต๊อก ")).resolves.toBe(false);
    });
    expect(showValidationMessageMock).toHaveBeenCalledWith("กรุณาพิมพ์ ล้างสต๊อก ให้ตรงกัน");
    expect(onClear).not.toHaveBeenCalled();

    await act(async () => {
      await expect(options.preConfirm("ล้างสต๊อก")).resolves.toEqual(clearedDocument);
    });
    expect(onClear).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("shows loading guards and a success alert with the cleared quantity", async () => {
    isLoadingMock.mockReturnValue(true);
    fireMock
      .mockImplementationOnce(async (options: ConfirmationOptions) => ({
        isConfirmed: true,
        value: await options.preConfirm("ล้างสต๊อก"),
      }))
      .mockResolvedValueOnce({ isConfirmed: true });
    render(<ClearStockButton positiveVariants={2} totalPairs={5} onClear={vi.fn().mockResolvedValue(clearedDocument)} />);

    fireEvent.click(screen.getByRole("button", { name: "ล้างสต๊อก" }));
    await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(2));
    const confirmation = fireMock.mock.calls[0][0] as ConfirmationOptions;
    expect(confirmation.allowOutsideClick()).toBe(false);
    expect(confirmation.allowEscapeKey()).toBe(false);
    expect(fireMock.mock.calls[1][0]).toMatchObject({
      icon: "success",
      title: "ล้างสต๊อกแล้ว",
      text: "ล้างสต๊อกเรียบร้อย 5 คู่",
    });
  });

  it("keeps the confirmation open and shows a Thai mutation error", async () => {
    fireMock.mockResolvedValueOnce({ isConfirmed: false });
    render(<ClearStockButton positiveVariants={2} totalPairs={5} onClear={vi.fn().mockRejectedValue(new Error("เชื่อมต่อไม่ได้"))} />);
    fireEvent.click(screen.getByRole("button", { name: "ล้างสต๊อก" }));
    await waitFor(() => expect(fireMock).toHaveBeenCalledTimes(1));

    const options = fireMock.mock.calls[0][0] as ConfirmationOptions;
    await act(async () => {
      await expect(options.preConfirm("ล้างสต๊อก")).resolves.toBe(false);
    });
    expect(showValidationMessageMock).toHaveBeenCalledWith("เชื่อมต่อไม่ได้");
  });
});
```

- [ ] **Step 3: Run the component test and verify RED**

```powershell
npm test -- tests/components/clear-stock-button.test.tsx
```

Expected: FAIL because `clear-stock-button.tsx` does not exist.

- [ ] **Step 4: Implement the SweetAlert2 button**

Create `src/features/inventory/components/clear-stock-button.tsx`:

```tsx
"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import Swal from "sweetalert2";
import { Button } from "@/components/ui/button";
import type { StockDocument } from "@/features/inventory/domain/types";

const confirmationPhrase = "ล้างสต๊อก";
const fallbackError = "ไม่สามารถล้างสต๊อกได้ กรุณาลองใหม่อีกครั้ง";

interface ClearStockButtonProps {
  positiveVariants: number;
  totalPairs: number;
  onClear(effectiveDate: string): Promise<StockDocument | null>;
}

function localDateValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ClearStockButton({ positiveVariants, totalPairs, onClear }: ClearStockButtonProps) {
  const [clearing, setClearing] = useState(false);

  async function confirmClear() {
    const result = await Swal.fire({
      icon: "warning",
      title: "ยืนยันล้างสต๊อก",
      text: `สินค้าที่มียอด ${positiveVariants} รายการ รวม ${totalPairs} คู่ จะถูกปรับเป็น 0`,
      input: "text",
      inputLabel: `พิมพ์ ${confirmationPhrase} เพื่อยืนยัน`,
      inputAttributes: { autocomplete: "off", "aria-label": "พิมพ์คำยืนยันล้างสต๊อก" },
      showCancelButton: true,
      confirmButtonText: "ยืนยันล้างสต๊อก",
      cancelButtonText: "ยกเลิก",
      confirmButtonColor: "#b74435",
      focusCancel: true,
      showLoaderOnConfirm: true,
      allowOutsideClick: () => !Swal.isLoading(),
      allowEscapeKey: () => !Swal.isLoading(),
      preConfirm: async (value) => {
        if (value !== confirmationPhrase) {
          Swal.showValidationMessage(`กรุณาพิมพ์ ${confirmationPhrase} ให้ตรงกัน`);
          return false;
        }
        setClearing(true);
        try {
          return await onClear(localDateValue());
        } catch (error) {
          Swal.showValidationMessage(error instanceof Error ? error.message : fallbackError);
          return false;
        } finally {
          setClearing(false);
        }
      },
    });

    if (!result.isConfirmed) return;
    const document = result.value as StockDocument | null;
    const clearedPairs = document?.lines.reduce((total, line) => total + Math.abs(line.delta), 0) ?? 0;
    await Swal.fire({
      icon: "success",
      title: "ล้างสต๊อกแล้ว",
      text: clearedPairs > 0 ? `ล้างสต๊อกเรียบร้อย ${clearedPairs} คู่` : "สต๊อกเป็น 0 อยู่แล้ว",
      confirmButtonText: "ตกลง",
      confirmButtonColor: "#237b58",
    });
  }

  return (
    <Button
      className="clear-stock-button"
      variant="secondary"
      disabled={clearing || totalPairs === 0}
      aria-busy={clearing}
      onClick={() => void confirmClear()}
    >
      <Trash2 aria-hidden size={17} />
      ล้างสต๊อก
    </Button>
  );
}
```

- [ ] **Step 5: Load SweetAlert2 styles from the local package**

Add before `./globals.css` in `src/app/layout.tsx`:

```ts
import "sweetalert2/dist/sweetalert2.min.css";
```

- [ ] **Step 6: Run the focused tests and verify GREEN**

```powershell
npm test -- tests/components/clear-stock-button.test.tsx
npm run typecheck
npm run lint
```

Expected: the component suite, TypeScript, and ESLint pass.

- [ ] **Step 7: Commit SweetAlert2 integration**

```powershell
git add package.json package-lock.json src/app/layout.tsx src/features/inventory/components/clear-stock-button.tsx tests/components/clear-stock-button.test.tsx
git diff --cached --check
git commit -m "feat: add guarded clear stock confirmation"
```

---

### Task 5: Integrate the global clear action into the inventory page

**Files:**
- Modify: `src/app/inventory/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/components/inventory-page.test.tsx`

**Interfaces:**
- Consumes: `useInventory().clearStock` from Task 3.
- Consumes: `ClearStockButton` from Task 4.
- Produces: global positive-variant/pair totals independent of the visible filtered `rows`.

- [ ] **Step 1: Add failing filter-independence and zero-state tests**

Add this repository fixture to `tests/components/inventory-page.test.tsx`:

```tsx
class ZeroStockRepository extends DemoInventoryRepository {
  override async load(): Promise<InventorySnapshot> {
    const snapshot = await super.load();
    return {
      ...snapshot,
      balances: Object.fromEntries(snapshot.variants.map((variant) => [variant.id, 0])),
    };
  }
}
```

Add these tests:

```tsx
it("keeps clear stock enabled when filters hide globally available stock", async () => {
  const user = userEvent.setup();
  renderInventory();
  const clearButton = await screen.findByRole("button", { name: "ล้างสต๊อก" });
  expect(clearButton).toBeEnabled();

  await user.type(screen.getByRole("searchbox", { name: "ค้นหาสินค้า" }), "ไม่มีสินค้านี้");
  const summary = screen.getByRole("group", { name: "สรุปสินค้าคงคลัง" });
  expect(within(summary).getAllByText("0")).toHaveLength(2);
  expect(clearButton).toBeEnabled();
});

it("disables clear stock when every global balance is zero", async () => {
  render(<InventoryProvider repository={new ZeroStockRepository(new MemoryStorage())}><InventoryPageContent /></InventoryProvider>);
  expect(await screen.findByRole("button", { name: "ล้างสต๊อก" })).toBeDisabled();
});
```

- [ ] **Step 2: Run the inventory page tests and verify RED**

```powershell
npm test -- tests/components/inventory-page.test.tsx
```

Expected: FAIL because the `ล้างสต๊อก` button is not rendered.

- [ ] **Step 3: Derive global totals and render the clear action**

Update the inventory hook destructure and imports in `src/app/inventory/page.tsx`:

```tsx
import { ClearStockButton } from "@/features/inventory/components/clear-stock-button";

const { snapshot, loading, error: repositoryError, clearStock, saveLowStockThreshold } = useInventory();
```

Add this memo after the filtered `totalPairs`:

```tsx
const clearSummary = useMemo(() => {
  if (!snapshot) return { positiveVariants: 0, totalPairs: 0 };
  return Object.values(snapshot.balances).reduce(
    (summary, quantity) => ({
      positiveVariants: summary.positiveVariants + (quantity > 0 ? 1 : 0),
      totalPairs: summary.totalPairs + quantity,
    }),
    { positiveVariants: 0, totalPairs: 0 },
  );
}, [snapshot]);
```

Replace the current `inventory-summary` element with:

```tsx
<div className="inventory-header-actions">
  <div className="inventory-summary" role="group" aria-label="สรุปสินค้าคงคลัง">
    <span className="inventory-count"><strong>{rows.length}</strong><small>รายการ</small></span>
    <span className="inventory-count"><strong>{totalPairs}</strong><small>คู่</small></span>
  </div>
  <ClearStockButton
    positiveVariants={clearSummary.positiveVariants}
    totalPairs={clearSummary.totalPairs}
    onClear={clearStock}
  />
</div>
```

- [ ] **Step 4: Add responsive destructive-action styling**

Update the inventory header rules in `src/app/globals.css`:

```css
.inventory-header { align-items: center; flex-wrap: wrap; }
.inventory-header-actions { display: grid; justify-items: end; gap: 10px; margin-left: auto; }
.inventory-summary { display: flex; flex-shrink: 0; gap: 10px; }
.clear-stock-button { color: #a63d31; border-color: #e3b8b1; background: #fff7f5; }
.clear-stock-button:hover:not(:disabled) { color: #8f3027; border-color: #d9988e; background: #ffebe7; }
```

Replace the narrow-screen inventory summary rules with:

```css
@media (max-width: 559px) {
  .inventory-header > div:first-child { min-width: 0; flex: 1 1 100%; }
  .inventory-header-actions { width: 100%; }
  .inventory-summary { justify-content: flex-end; }
  .clear-stock-button { width: 100%; }
}
```

- [ ] **Step 5: Run focused page and SweetAlert tests**

```powershell
npm test -- tests/components/inventory-page.test.tsx tests/components/clear-stock-button.test.tsx
```

Expected: both suites pass.

- [ ] **Step 6: Commit inventory-page integration**

```powershell
git add src/app/inventory/page.tsx src/app/globals.css tests/components/inventory-page.test.tsx
git diff --cached --check
git commit -m "feat: add clear stock inventory action"
```

---

### Task 6: Verify the real dialog, deployment migration, and release

**Files:**
- Modify: `tests/e2e/inventory.spec.ts`

**Interfaces:**
- Consumes: the real SweetAlert2 dialog and demo repository clear path.
- Verifies: desktop workflow, mobile layout, preserved catalog/history, and remote RPC availability.

- [ ] **Step 1: Extend the desktop E2E workflow with the real clear dialog**

After the existing desktop inventory quantity assertions in `tests/e2e/inventory.spec.ts`, add:

```ts
const inventorySummary = page.getByRole("group", { name: "สรุปสินค้าคงคลัง" });
await page.getByRole("button", { name: "ล้างสต๊อก" }).click();
const clearDialog = page.getByRole("dialog", { name: "ยืนยันล้างสต๊อก" });
await clearDialog.getByRole("textbox", { name: "พิมพ์คำยืนยันล้างสต๊อก" }).fill("ล้าง stock");
await clearDialog.getByRole("button", { name: "ยืนยันล้างสต๊อก" }).click();
await expect(clearDialog).toContainText("กรุณาพิมพ์ ล้างสต๊อก ให้ตรงกัน");
await clearDialog.getByRole("textbox", { name: "พิมพ์คำยืนยันล้างสต๊อก" }).fill("ล้างสต๊อก");
await clearDialog.getByRole("button", { name: "ยืนยันล้างสต๊อก" }).click();

const successDialog = page.getByRole("dialog", { name: "ล้างสต๊อกแล้ว" });
await expect(successDialog).toContainText("คู่");
await successDialog.getByRole("button", { name: "ตกลง" }).click();
await expect(inventorySummary.getByText("0", { exact: true })).toBeVisible();
await expect(page.getByRole("button", { name: "ล้างสต๊อก" })).toBeDisabled();

await mainNavigation.getByRole("link", { name: "ประวัติ" }).click();
const clearedHistory = page.getByRole("table", { name: "ประวัติการเคลื่อนไหวสต็อก" });
await expect(clearedHistory.getByRole("row").filter({ hasText: "CLEAR-STOCK" })).toContainText("ปรับยอด");

await mainNavigation.getByRole("link", { name: "จัดการสินค้า" }).click();
await expect(page.getByRole("region", { name: "จัดการรุ่นรองเท้า" })).toContainText("E2E Runner");
await expect(page.getByRole("region", { name: "จัดการสี" })).toContainText("E2E White");
```

Inside the mobile inventory navigation check, add:

```ts
if (check.name === "สินค้าคงคลัง") {
  await expectTouchTarget(page, page.getByRole("button", { name: "ล้างสต๊อก" }));
}
```

- [ ] **Step 2: Run E2E and verify GREEN**

```powershell
npm run e2e -- tests/e2e/inventory.spec.ts
```

Expected: all three Playwright projects pass with the SweetAlert2 confirmation and success dialogs located by their accessible titles.

- [ ] **Step 3: Run every local regression check**

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run e2e -- tests/e2e/inventory.spec.ts
git diff --check
```

Expected: all Vitest suites, TypeScript, ESLint, the nine-route production build, and Playwright at 1440×900, 390×844, and 360×800 pass without horizontal overflow.

- [ ] **Step 4: Commit E2E coverage**

```powershell
git add tests/e2e/inventory.spec.ts
git diff --cached --check
git commit -m "test: cover guarded inventory clear workflow"
```

- [ ] **Step 5: Dry-run and apply the remote Supabase migration**

Run against the linked project:

```powershell
npx supabase db push --dry-run
npx supabase db push
```

Expected: only `202607220003_clear_inventory_stock.sql` is pending and then applied. If the project is not linked or CLI credentials are unavailable, stop and ask the user to link/login or run the exact migration file in Supabase SQL Editor; do not claim production completion until the RPC exists remotely.

- [ ] **Step 6: Verify final Git scope and push master**

```powershell
git status --short
git log --oneline -8
git push origin master
```

Expected: `next-env.d.ts` is the only remaining unstaged file, and `origin/master` advances through all clear-stock commits.
