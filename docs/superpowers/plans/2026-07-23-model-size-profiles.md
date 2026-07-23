# Model-specific Text Size Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace numeric-only shoe sizes with normalized text labels, provide the approved Paris/Castor and Weave fitting profiles, preserve existing stock/history, and allow staff to create custom alphabetic sizes.

**Architecture:** Add one pure size-label module as the canonical source for normalization, fitting guidance, and ordering. Migrate application types and repositories to string labels, upgrade persisted demo data without changing identities, and add a forward-only Supabase migration that converts deployed numeric columns and replaces the affected RPCs. UI selectors use profile metadata for detailed guidance while all operational and printed surfaces retain concise labels.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Zod 4, Supabase/PostgreSQL, Vitest/Testing Library, Playwright, CSS print media.

## Global Constraints

- Paris and Castor standard sizes are `XS`, `S`, `M`, `L`, `XL`, `2XL`, `3XL` with the exact EU/CM mappings in the approved spec.
- Weave standard sizes are `39`, `40`, `41`, `42`, `43`, `44`, `45` with the exact CM mappings in the approved spec.
- Canonical size identity is a normalized string of 1–24 Unicode characters; trim, collapse whitespace, uppercase, and reject control characters.
- Preserve every existing variant ID, balance, stock document, production order, and historical reference.
- Do not edit deployed migrations `202607220001` through `202607220004`; create migration `202607230005`.
- Keep the shared no-login access model and current narrow RPC grants.
- Select controls show fitting guidance; inventory, history, production orders, and A4 print/PDF show only concise labels.
- Custom size creation remains part of the first receipt workflow and accepts letters, numbers, Thai text, spaces, `.`, `/`, `+`, and `-`.
- Preserve the user's unrelated local change in `next-env.d.ts`; never stage or commit it.
- Do not add a size-profile administration screen or a new dependency.

## File Structure

- Create `src/features/inventory/domain/size-label.ts`: normalization, approved profile metadata, option formatting, and deterministic comparison.
- Create `tests/unit/size-label.test.ts`: pure contract tests for the size-label module.
- Create `supabase/migrations/202607230005_text_size_profiles.sql`: forward conversion, profile seeding, RPC replacement, and ACLs.
- Modify inventory domain/data/provider files so every size boundary uses `string`.
- Modify production-order domain/data files so snapshotted sizes use `string` and legacy demo orders upgrade safely.
- Modify `DocumentLineEditor` and receive preparation so custom sizes are text and selectors show guidance.
- Modify affected unit/component/E2E fixtures from numeric sizes to canonical strings.
- Modify `README.md` to document model-specific profiles and text-size creation.

---

### Task 1: Canonical size labels and model profiles

**Files:**
- Create: `src/features/inventory/domain/size-label.ts`
- Create: `tests/unit/size-label.test.ts`

**Interfaces:**
- Produces:
  - `SIZE_LABEL_MAX_LENGTH: 24`
  - `normalizeSizeLabel(value: unknown): string | null`
  - `sizeProfileForModel(modelName: string): readonly SizeProfileEntry[]`
  - `formatSizeOption(modelName: string, size: string): string`
  - `compareSizeLabels(modelName: string, left: string, right: string): number`
  - `SizeProfileEntry { label: string; euRange?: string; footLength: string }`

- [ ] **Step 1: Write the failing pure-domain tests**

```ts
import { describe, expect, it } from "vitest";
import {
  compareSizeLabels,
  formatSizeOption,
  normalizeSizeLabel,
  sizeProfileForModel,
} from "@/features/inventory/domain/size-label";

describe("size labels", () => {
  it.each([
    ["  xl  ", "XL"],
    ["m   /   l", "M / L"],
    [39, "39"],
    [38.5, "38.5"],
    ["ฟรีไซซ์", "ฟรีไซซ์"],
  ])("normalizes %p to %s", (input, expected) => {
    expect(normalizeSizeLabel(input)).toBe(expected);
  });

  it.each(["", "   ", "A".repeat(25), "M\u0000L", null, undefined])(
    "rejects invalid label %p",
    (input) => expect(normalizeSizeLabel(input)).toBeNull(),
  );

  it("exposes the approved profiles and detailed selector copy", () => {
    expect(sizeProfileForModel("paris").map((entry) => entry.label))
      .toEqual(["XS", "S", "M", "L", "XL", "2XL", "3XL"]);
    expect(sizeProfileForModel("Castor")[2]).toEqual({
      label: "M",
      euRange: "39–40",
      footLength: "24–24.5 cm",
    });
    expect(sizeProfileForModel("WEAVE").map((entry) => entry.label))
      .toEqual(["39", "40", "41", "42", "43", "44", "45"]);
    expect(formatSizeOption("Paris", "M")).toBe("M — EU 39–40 · 24–24.5 cm");
    expect(formatSizeOption("Weave", "42")).toBe("42 — 26–26.5 cm");
    expect(formatSizeOption("Runner", "FREE")).toBe("FREE");
  });

  it("orders profile labels first and custom labels naturally afterward", () => {
    expect(["10XL", "FREE", "S", "XS", "2XL"].sort((a, b) =>
      compareSizeLabels("Paris", a, b)))
      .toEqual(["XS", "S", "2XL", "10XL", "FREE"]);
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
npm test -- tests/unit/size-label.test.ts
```

Expected: FAIL because `@/features/inventory/domain/size-label` does not exist.

- [ ] **Step 3: Implement the canonical module**

```ts
export const SIZE_LABEL_MAX_LENGTH = 24;

export interface SizeProfileEntry {
  label: string;
  euRange?: string;
  footLength: string;
}

const PARIS_CASTOR_PROFILE = [
  { label: "XS", euRange: "36–37", footLength: "22–22.5 cm" },
  { label: "S", euRange: "37–38", footLength: "23–23.5 cm" },
  { label: "M", euRange: "39–40", footLength: "24–24.5 cm" },
  { label: "L", euRange: "40–41", footLength: "25–25.5 cm" },
  { label: "XL", euRange: "42–43", footLength: "26–26.5 cm" },
  { label: "2XL", euRange: "44–45", footLength: "27–27.5 cm" },
  { label: "3XL", euRange: "45–46", footLength: "28–28.5 cm" },
] as const;

const WEAVE_PROFILE = [
  { label: "39", footLength: "23–23.5 cm" },
  { label: "40", footLength: "24–24.5 cm" },
  { label: "41", footLength: "25–25.5 cm" },
  { label: "42", footLength: "26–26.5 cm" },
  { label: "43", footLength: "26.5–27 cm" },
  { label: "44", footLength: "27–27.5 cm" },
  { label: "45", footLength: "28–28.5 cm" },
] as const;

const naturalCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function normalizedModelName(value: string): string {
  return value.trim().toLocaleUpperCase("en-US");
}

export function normalizeSizeLabel(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value)
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleUpperCase();
  if (!normalized
    || [...normalized].length > SIZE_LABEL_MAX_LENGTH
    || /[\p{Cc}\p{Cf}]/u.test(normalized)) return null;
  return normalized;
}

export function sizeProfileForModel(modelName: string): readonly SizeProfileEntry[] {
  const model = normalizedModelName(modelName);
  if (model === "PARIS" || model === "CASTOR") return PARIS_CASTOR_PROFILE;
  if (model === "WEAVE") return WEAVE_PROFILE;
  return [];
}

export function formatSizeOption(modelName: string, size: string): string {
  const profile = sizeProfileForModel(modelName);
  const entry = profile.find((candidate) => candidate.label === size);
  if (!entry) return size;
  return entry.euRange
    ? `${entry.label} — EU ${entry.euRange} · ${entry.footLength}`
    : `${entry.label} — ${entry.footLength}`;
}

export function compareSizeLabels(modelName: string, left: string, right: string): number {
  const labels = sizeProfileForModel(modelName).map((entry) => entry.label);
  const leftIndex = labels.indexOf(left);
  const rightIndex = labels.indexOf(right);
  if (leftIndex >= 0 || rightIndex >= 0) {
    if (leftIndex < 0) return 1;
    if (rightIndex < 0) return -1;
    return leftIndex - rightIndex;
  }
  return naturalCollator.compare(left, right);
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
npm test -- tests/unit/size-label.test.ts
```

Expected: 1 test file passes.

- [ ] **Step 5: Commit**

```powershell
git add -- src/features/inventory/domain/size-label.ts tests/unit/size-label.test.ts
git diff --cached --check
git commit -m "feat: add model-specific size profiles"
```

---

### Task 2: Convert inventory domain and repository boundaries to text labels

**Files:**
- Modify: `src/features/inventory/domain/types.ts`
- Modify: `src/features/inventory/domain/validation.ts`
- Modify: `src/features/inventory/domain/post-document.ts`
- Modify: `src/features/inventory/domain/selectors.ts`
- Modify: `src/features/inventory/domain/history.ts`
- Modify: `src/features/inventory/data/inventory-repository.ts`
- Modify: `src/features/inventory/data/demo-repository.ts`
- Modify: `src/features/inventory/data/supabase-repository.ts`
- Modify: `src/features/inventory/inventory-provider.tsx`
- Modify: `src/features/production-orders/domain/types.ts`
- Modify: `src/features/production-orders/data/demo-production-order-repository.ts`
- Modify: `src/features/production-orders/data/supabase-production-order-repository.ts`
- Modify: `src/lib/supabase.ts`
- Modify: `tests/unit/validation.test.ts`
- Modify: `tests/unit/post-document.test.ts`
- Modify: `tests/unit/selectors.test.ts`
- Modify: `tests/unit/history.test.ts`
- Modify: `tests/unit/supabase-mapping.test.ts`
- Modify: `tests/unit/supabase-repository.test.ts`
- Modify: `tests/unit/supabase-production-order-repository.test.ts`

**Interfaces:**
- Consumes: all Task 1 exports.
- Produces:
  - `ProductVariant.size: string`
  - `StockDocumentLineInput.size: string`
  - `ProductionOrderLine.size: string`
  - `InventoryRepository.ensureVariant(modelId: string, colorId: string, size: string)`

- [ ] **Step 1: Change test fixtures to demand canonical string sizes**

Add assertions such as:

```ts
expect(validateDocument({
  type: "RECEIPT",
  effectiveDate: "2026-07-23",
  lines: [{ variantId: "variant-m", size: "M", quantity: 2 }],
})).toMatchObject({
  success: true,
  data: { lines: [{ size: "M" }] },
});

expect(validateDocument({
  type: "RECEIPT",
  effectiveDate: "2026-07-23",
  lines: [{ variantId: "variant-blank", size: "", quantity: 1 }],
})).toMatchObject({
  success: false,
  errors: [expect.objectContaining({
    path: "lines.0.size",
    code: "INVALID_SIZE",
    message: "กรุณาระบุไซซ์รองเท้า",
  })],
});
```

Change Supabase mapping fixtures to expect:

```ts
expect(snapshot.variants[0].size).toBe("38.5");
```

Change production-order RPC fixtures from `size: 38` to `size: "M"` and require
the strict mapper to reject numeric responses after the migration boundary.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test -- tests/unit/validation.test.ts tests/unit/post-document.test.ts tests/unit/selectors.test.ts tests/unit/history.test.ts tests/unit/supabase-mapping.test.ts tests/unit/supabase-repository.test.ts tests/unit/supabase-production-order-repository.test.ts
```

Expected: FAIL on numeric-only schemas, arithmetic sorting, and numeric production-order response validation.

- [ ] **Step 3: Convert types and validation**

Use `string` for every size property and signature. Replace the numeric size
schema with:

```ts
const sizeLabelSchema = z.string().transform((value, context) => {
  const normalized = normalizeSizeLabel(value);
  if (!normalized) {
    context.addIssue({ code: "custom", message: "INVALID_SIZE" });
    return z.NEVER;
  }
  return normalized;
});
```

Set the Thai size error to `กรุณาระบุไซซ์รองเท้า`. In `postDocument`, compare
normalized string equality instead of numeric equality:

```ts
if (!variant || variant.size !== line.size) {
  throw new Error("VARIANT_NOT_FOUND");
}
```

In inventory selectors, replace subtraction with:

```ts
compareSizeLabels(left.modelName, left.size, right.size)
  || left.variantId.localeCompare(right.variantId)
```

- [ ] **Step 4: Convert repository and Supabase mapping boundaries**

At response boundaries, accept only a label that normalizes to itself:

```ts
const normalizedSize = normalizeSizeLabel(value.size);
if (!normalizedSize || normalizedSize !== value.size) return invalidSnapshot();
```

Update `src/lib/supabase.ts`:

```ts
type ProductVariantRow = {
  id: string;
  model_id: string;
  color_id: string;
  size: string;
  low_stock_threshold: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

ensure_product_variant: {
  Args: { p_model_id: string; p_color_id: string; p_size: string };
  Returns: Json;
};
```

Update production-order response validation to require a canonical string:

```ts
const size = normalizeSizeLabel(value.size);
if (!size || size !== value.size) {
  throw new Error("ข้อมูลใบผลิตจากเซิร์ฟเวอร์ไม่ถูกต้อง");
}
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```powershell
npm test -- tests/unit/validation.test.ts tests/unit/post-document.test.ts tests/unit/selectors.test.ts tests/unit/history.test.ts tests/unit/supabase-mapping.test.ts tests/unit/supabase-repository.test.ts tests/unit/supabase-production-order-repository.test.ts
npm run typecheck
```

Expected: focused tests and TypeScript pass. If TypeScript reports UI numeric
preparation errors, make only the mechanical `string` signature changes needed;
Task 4 owns the user-facing behavior.

- [ ] **Step 6: Commit**

```powershell
git add -- src/features/inventory/domain src/features/inventory/data src/features/inventory/inventory-provider.tsx src/features/production-orders/domain/types.ts src/features/production-orders/data src/lib/supabase.ts tests/unit
git diff --cached --check
git commit -m "refactor: use text labels for shoe sizes"
```

---

### Task 3: Seed model profiles and upgrade persisted demo data

**Files:**
- Modify: `src/features/inventory/data/seed.ts`
- Modify: `src/features/inventory/data/demo-repository.ts`
- Modify: `src/features/production-orders/data/demo-production-order-repository.ts`
- Modify: `tests/unit/demo-repository.test.ts`
- Modify: `tests/unit/demo-production-order-repository.test.ts`

**Interfaces:**
- Consumes: `normalizeSizeLabel`, `sizeProfileForModel`.
- Produces: fresh profile-based demo data and lossless numeric-to-string storage upgrades.

- [ ] **Step 1: Add failing seed and upgrade tests**

```ts
it("seeds the approved sizes per model", async () => {
  const snapshot = await new DemoInventoryRepository(new MemoryStorage()).load();
  const labelsFor = (modelName: string) => {
    const model = snapshot.models.find((item) => item.name === modelName)!;
    return [...new Set(snapshot.variants
      .filter((variant) => variant.modelId === model.id)
      .map((variant) => variant.size))];
  };
  expect(labelsFor("Paris")).toEqual(["XS", "S", "M", "L", "XL", "2XL", "3XL"]);
  expect(labelsFor("Castor")).toEqual(["XS", "S", "M", "L", "XL", "2XL", "3XL"]);
  expect(labelsFor("Weave")).toEqual(["39", "40", "41", "42", "43", "44", "45"]);
});

it("upgrades numeric sizes without changing identities or balances", async () => {
  const storage = new MemoryStorage();
  const legacy = createLegacyNumericSnapshotFixture();
  storage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(legacy));
  const upgraded = await new DemoInventoryRepository(storage).load();
  expect(upgraded.variants[0]).toMatchObject({
    id: legacy.variants[0].id,
    size: String(legacy.variants[0].size),
  });
  expect(upgraded.balances).toEqual(legacy.balances);
});
```

For production orders, store a valid legacy line with `size: 38` and assert
`load()` returns the same order/line IDs with `size: "38"`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
npm test -- tests/unit/demo-repository.test.ts tests/unit/demo-production-order-repository.test.ts
```

Expected: FAIL because the seed remains numeric and persisted numeric sizes are rejected.

- [ ] **Step 3: Build the fresh seed from model profiles**

Replace the global numeric size array with model-specific labels:

```ts
const sizeLabelsByModel = {
  Paris: ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
  Castor: ["XS", "S", "M", "L", "XL", "2XL", "3XL"],
  Weave: ["39", "40", "41", "42", "43", "44", "45"],
} as const;
```

Use lowercase encoded labels in deterministic IDs:

```ts
function sizeIdPart(size: string): string {
  return encodeURIComponent(size.toLocaleLowerCase("en-US"));
}
```

Keep 63 variants, all existing model-color pairs, threshold `3`, and the current
deterministic balance pattern.

- [ ] **Step 4: Add tolerant legacy readers with canonical writes**

Do not loosen the in-memory type guard. Instead, add a persisted-data projector
that accepts numeric or string `size`, calls `normalizeSizeLabel`, preserves all
IDs and relations, and rejects normalized duplicates within one model/color.
`load()` returns the projected snapshot. The next successful mutation publishes
only the canonical string form.

Apply the same projection to production-order persisted lines. Preserve the
storage key, order IDs, line IDs, receipt links, revisions, and timestamps.

- [ ] **Step 5: Run focused tests and typecheck**

```powershell
npm test -- tests/unit/demo-repository.test.ts tests/unit/demo-production-order-repository.test.ts
npm run typecheck
```

Expected: focused tests and typecheck pass.

- [ ] **Step 6: Commit**

```powershell
git add -- src/features/inventory/data/seed.ts src/features/inventory/data/demo-repository.ts src/features/production-orders/data/demo-production-order-repository.ts tests/unit/demo-repository.test.ts tests/unit/demo-production-order-repository.test.ts
git diff --cached --check
git commit -m "feat: seed and upgrade text shoe sizes"
```

---

### Task 4: Detailed size selectors and custom text entry

**Files:**
- Modify: `src/features/inventory/components/document-line-editor.tsx`
- Modify: `src/app/receive/page.tsx`
- Modify: `src/app/inventory/page.tsx`
- Modify: `tests/components/receive-page.test.tsx`
- Modify: `tests/components/inventory-page.test.tsx`
- Modify: `tests/components/issue-page.test.tsx`
- Modify: `tests/components/exchange-page.test.tsx`
- Modify: `tests/e2e/inventory.spec.ts`

**Interfaces:**
- Consumes: `formatSizeOption`, `compareSizeLabels`, `normalizeSizeLabel`.
- Produces: detailed selector labels and the text-based first-receipt creation flow.

- [ ] **Step 1: Add failing component tests**

```ts
it("shows profile guidance and accepts an alphabetic custom size", async () => {
  const user = userEvent.setup();
  const repository = renderReceipt();
  await screen.findByRole("heading", { name: "รับสินค้า" });

  await user.selectOptions(screen.getByRole("combobox", {
    name: "รุ่นสินค้า รายการ 1",
  }), "paris");
  await user.selectOptions(screen.getByRole("combobox", {
    name: "สีสินค้า รายการ 1",
  }), "black");
  expect(screen.getByRole("option", {
    name: "M — EU 39–40 · 24–24.5 cm",
  })).toBeInTheDocument();

  await user.selectOptions(screen.getByRole("combobox", {
    name: "ไซซ์ รายการ 1",
  }), "__new__");
  const custom = screen.getByRole("textbox", {
    name: "ไซซ์ใหม่ รายการ 1",
  });
  await user.type(custom, " free ");
  await user.type(screen.getByRole("spinbutton", {
    name: "จำนวน (คู่) รายการ 1",
  }), "2");
  await user.click(screen.getByRole("button", { name: "บันทึกรับสินค้า" }));

  expect(await screen.findByRole("status", { name: "บันทึกสำเร็จ" }))
    .toHaveTextContent("รับสินค้าเรียบร้อย");
  expect(repository.ensured.at(-1)?.size).toBe("FREE");
});
```

Add a Weave assertion for `42 — 26–26.5 cm`. Add inventory assertions that cells
show `M` or `42`, never the fitting guidance.

- [ ] **Step 2: Run component tests and verify RED**

```powershell
npm test -- tests/components/receive-page.test.tsx tests/components/inventory-page.test.tsx tests/components/issue-page.test.tsx tests/components/exchange-page.test.tsx
```

Expected: FAIL because the new-size field is a spinbutton and option copy is compact.

- [ ] **Step 3: Implement detailed option copy and deterministic ordering**

Resolve the selected model name and sort size variants:

```ts
const modelName = models.find((model) => model.id === line.modelId)?.name ?? "";
const sizes = variants
  .filter((variant) =>
    variant.modelId === line.modelId && variant.colorId === line.colorId)
  .sort((left, right) =>
    compareSizeLabels(modelName, left.size, right.size)
    || left.id.localeCompare(right.id));
```

Render:

```tsx
<option value={variant.size} key={variant.id}>
  {formatSizeOption(modelName, variant.size)}
</option>
```

Change the custom field to:

```tsx
<Field
  id={`${controlId}-new-size`}
  label={`ไซซ์ใหม่ รายการ ${rowNumber}`}
  type="text"
  autoCapitalize="characters"
  maxLength={SIZE_LABEL_MAX_LENGTH}
  value={line.newSize}
  error={sizeError ?? variantError}
  announceError={false}
  onChange={(event) => updateLine(
    line.id,
    { newSize: event.target.value },
    ["variantId", "size", "section"],
  )}
/>
```

- [ ] **Step 4: Normalize receive preparation**

Replace `Number(line.newSize)` and numeric positivity with:

```ts
const size = line.creatingVariant
  ? normalizeSizeLabel(line.newSize) ?? ""
  : selected?.size ?? "";
const matching = variants.find((variant) =>
  variant.modelId === line.modelId
  && variant.colorId === line.colorId
  && variant.size === size);
```

Use `size` in the optimistic `new:` identity only when non-empty. The repository
normalizes again before mutation.

- [ ] **Step 5: Run component tests, typecheck, and focused E2E**

```powershell
npm test -- tests/components/receive-page.test.tsx tests/components/inventory-page.test.tsx tests/components/issue-page.test.tsx tests/components/exchange-page.test.tsx
npm run typecheck
npm run e2e -- tests/e2e/inventory.spec.ts --project=desktop
```

Expected: all commands pass. The desktop E2E creates a custom `FREE` or `M/L`
variant and confirms its concise inventory cell.

- [ ] **Step 6: Commit**

```powershell
git add -- src/features/inventory/components/document-line-editor.tsx src/app/receive/page.tsx src/app/inventory/page.tsx tests/components tests/e2e/inventory.spec.ts
git diff --cached --check
git commit -m "feat: add guided and custom text sizes"
```

---

### Task 5: Production-order persistence and compact print labels

**Files:**
- Modify: `src/features/production-orders/data/demo-production-order-repository.ts`
- Modify: `src/features/production-orders/data/supabase-production-order-repository.ts`
- Modify: `src/features/production-orders/components/production-order-form.tsx`
- Modify: `src/features/production-orders/components/production-order-print.tsx`
- Modify: `src/app/production-orders/[id]/page.tsx`
- Modify: `tests/unit/demo-production-order-repository.test.ts`
- Modify: `tests/unit/supabase-production-order-repository.test.ts`
- Modify: `tests/components/production-order-form.test.tsx`
- Modify: `tests/components/production-order-detail.test.tsx`
- Modify: `tests/components/production-order-print.test.tsx`

**Interfaces:**
- Consumes: canonical string variants from Tasks 2–3.
- Produces: production orders whose snapshots and printed rows preserve concise string labels.

- [ ] **Step 1: Add failing production-order coverage**

Use a Paris `M` variant and require:

```ts
expect(created.lines[0]).toMatchObject({
  modelName: "Paris",
  colorName: "Black",
  size: "M",
  quantity: 4,
});
```

In print coverage:

```ts
expect(screen.getByRole("table", { name: "รายการสั่งผลิต" }))
  .toHaveTextContent("M");
expect(screen.getByRole("table", { name: "รายการสั่งผลิต" }))
  .not.toHaveTextContent("24–24.5 cm");
```

Persist a legacy numeric demo order and require lossless `size: "38"` projection.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm test -- tests/unit/demo-production-order-repository.test.ts tests/unit/supabase-production-order-repository.test.ts tests/components/production-order-form.test.tsx tests/components/production-order-detail.test.tsx tests/components/production-order-print.test.tsx
```

Expected: FAIL on numeric legacy data or old numeric fixtures.

- [ ] **Step 3: Complete strict mapping and legacy upgrade**

At new Supabase boundaries, require canonical strings. In demo persistence,
accept legacy numeric line sizes only during read projection:

```ts
const size = normalizeSizeLabel(value.size);
if (!size) return false;
return { ...value, size };
```

Do not include profile guidance in a `ProductionOrderLine`; it remains a snapshot
of model name, color name, concise size label, and quantity.

- [ ] **Step 4: Keep every operational and print surface concise**

Verify the form selector uses Task 4 option formatting but saved order details,
cards, tables, and `ProductionOrderPrint` render `line.size` directly. Do not
append EU or CM metadata outside selection controls.

- [ ] **Step 5: Run focused tests and build**

```powershell
npm test -- tests/unit/demo-production-order-repository.test.ts tests/unit/supabase-production-order-repository.test.ts tests/components/production-order-form.test.tsx tests/components/production-order-detail.test.tsx tests/components/production-order-print.test.tsx
npm run typecheck
npm run build
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

```powershell
git add -- src/features/production-orders src/app/production-orders tests/unit/demo-production-order-repository.test.ts tests/unit/supabase-production-order-repository.test.ts tests/components/production-order-form.test.tsx tests/components/production-order-detail.test.tsx tests/components/production-order-print.test.tsx
git diff --cached --check
git commit -m "feat: support text sizes in production orders"
```

---

### Task 6: Forward-only Supabase text-size migration

**Files:**
- Create: `supabase/migrations/202607230005_text_size_profiles.sql`
- Modify: `tests/unit/supabase-migration.test.ts`
- Modify: `tests/unit/supabase-repository.test.ts`

**Interfaces:**
- Consumes: canonical normalization rules from Task 1, translated exactly to SQL.
- Produces:
  - `product_variants.size text`
  - `production_order_lines.size text`
  - `ensure_product_variant(uuid, uuid, text)`
  - string-compatible stock and production RPC payloads.

- [ ] **Step 1: Add failing migration contract tests**

```ts
const sizeMigration = readFileSync(
  resolve(process.cwd(),
    "supabase/migrations/202607230005_text_size_profiles.sql"),
  "utf8",
).replaceAll("\r\n", "\n").toLocaleLowerCase("en-US");

expect(sizeMigration).toContain(
  "alter table public.product_variants alter column size type text",
);
expect(sizeMigration).toContain(
  "alter table public.production_order_lines alter column size type text",
);
expect(sizeMigration).toContain(
  "create unique index product_variants_model_color_size_label_key",
);
expect(sizeMigration).toContain(
  "create or replace function public.ensure_product_variant(",
);
expect(sizeMigration).toContain("p_size text");
expect(sizeMigration).toContain(
  "drop function if exists public.ensure_product_variant(uuid, uuid, numeric)",
);
expect(sizeMigration).toContain("create or replace function public.post_stock_document(command jsonb)");
expect(sizeMigration).toContain("create or replace function public.save_production_order(command jsonb)");
expect(sizeMigration).toContain("create or replace function public.receive_production_order(command jsonb)");
expect(sizeMigration).toContain("('paris', 'xs')");
expect(sizeMigration).toContain("('castor', '3xl')");
expect(sizeMigration).toContain("('weave', '45')");
expect(sizeMigration).not.toMatch(/delete\s+from\s+public\.(?:product_variants|inventory_balances|stock_documents|production_orders)/);
```

- [ ] **Step 2: Run migration tests and verify RED**

```powershell
npm test -- tests/unit/supabase-migration.test.ts
```

Expected: FAIL because migration 005 does not exist.

- [ ] **Step 3: Add canonical SQL normalization and column conversion**

Start the migration with:

```sql
create or replace function public.normalize_size_label(raw_label text)
returns text
language sql
immutable
strict
security invoker
set search_path = pg_catalog, public
as $$
  select pg_catalog.upper(
    pg_catalog.regexp_replace(pg_catalog.btrim(raw_label), '[[:space:]]+', ' ', 'g')
  );
$$;

alter table public.product_variants
  drop constraint product_variants_model_color_size_key,
  drop constraint product_variants_size_positive;

alter table public.product_variants
  alter column size type text
  using public.normalize_size_label(
    pg_catalog.rtrim(pg_catalog.rtrim(size::text, '0'), '.')
  );

alter table public.product_variants
  add constraint product_variants_size_label_valid check (
    size = public.normalize_size_label(size)
    and pg_catalog.char_length(size) between 1 and 24
    and size !~ '[[:cntrl:]]'
  );

create unique index product_variants_model_color_size_label_key
  on public.product_variants (model_id, color_id, pg_catalog.lower(size));

alter table public.production_order_lines
  drop constraint production_order_lines_size_check;

alter table public.production_order_lines
  alter column size type text
  using public.normalize_size_label(
    pg_catalog.rtrim(pg_catalog.rtrim(size::text, '0'), '.')
  );

alter table public.production_order_lines
  add constraint production_order_lines_size_label_valid check (
    size = public.normalize_size_label(size)
    and pg_catalog.char_length(size) between 1 and 24
    and size !~ '[[:cntrl:]]'
  );
```

Migration 004 creates the inline numeric check with PostgreSQL's deterministic
name `production_order_lines_size_check`; drop that exact constraint before the
type conversion.

- [ ] **Step 4: Seed missing profiles without changing existing rows**

Derive currently configured model/color pairs from existing variants, then insert
only missing canonical profile labels:

```sql
with profiles (model_name, size_label) as (
  values
    ('paris', 'XS'), ('paris', 'S'), ('paris', 'M'), ('paris', 'L'),
    ('paris', 'XL'), ('paris', '2XL'), ('paris', '3XL'),
    ('castor', 'XS'), ('castor', 'S'), ('castor', 'M'), ('castor', 'L'),
    ('castor', 'XL'), ('castor', '2XL'), ('castor', '3XL'),
    ('weave', '39'), ('weave', '40'), ('weave', '41'), ('weave', '42'),
    ('weave', '43'), ('weave', '44'), ('weave', '45')
), configured_pairs as (
  select distinct variant.model_id, variant.color_id, pg_catalog.lower(model.name) as model_name
  from public.product_variants variant
  join public.shoe_models model on model.id = variant.model_id
)
insert into public.product_variants (model_id, color_id, size)
select pair.model_id, pair.color_id, profile.size_label
from configured_pairs pair
join profiles profile on profile.model_name = pair.model_name
on conflict do nothing;

insert into public.inventory_balances (variant_id, quantity)
select variant.id, 0
from public.product_variants variant
on conflict (variant_id) do nothing;
```

- [ ] **Step 5: Replace affected RPCs and restore ACLs**

Copy the complete current bodies of `get_inventory_snapshot`,
`post_stock_document`, `clear_inventory_stock`, `production_order_json`,
`get_production_orders`, `save_production_order`, and
`receive_production_order` into migration 005, then apply these exact semantic
changes throughout those copied bodies:

```sql
-- Accept legacy JSON numbers and new strings.
if pg_catalog.jsonb_typeof(line -> 'size') not in ('number', 'string') then
  raise exception using errcode = 'P0001', message = 'INVALID_SIZE_LABEL';
end if;
line_size_label := public.normalize_size_label(line ->> 'size');
if line_size_label is null
  or pg_catalog.char_length(line_size_label) not between 1 and 24
  or line_size_label ~ '[[:cntrl:]]' then
  raise exception using errcode = 'P0001', message = 'INVALID_SIZE_LABEL';
end if;
```

Compare `variant.size = line_size_label`, emit JSON `size` as a string, and
declare all former `line_size numeric` variables as `line_size_label text`.

Replace the ensure RPC with:

```sql
drop function if exists public.ensure_product_variant(uuid, uuid, numeric);

create or replace function public.ensure_product_variant(
  p_model_id uuid,
  p_color_id uuid,
  p_size text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_size text := public.normalize_size_label(p_size);
  ensured_variant public.product_variants%rowtype;
begin
  if normalized_size is null
    or pg_catalog.char_length(normalized_size) not between 1 and 24
    or normalized_size ~ '[[:cntrl:]]' then
    raise exception using errcode = 'P0001', message = 'INVALID_SIZE_LABEL';
  end if;

  if not exists (
    select 1
    from public.shoe_models model
    where model.id = p_model_id and model.active
  ) or not exists (
    select 1
    from public.colors color
    where color.id = p_color_id and color.active
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_VARIANT';
  end if;

  insert into public.product_variants (model_id, color_id, size, active)
  values (p_model_id, p_color_id, normalized_size, true)
  on conflict (model_id, color_id, pg_catalog.lower(size)) do update
    set active = true,
        updated_at = statement_timestamp()
  returning * into ensured_variant;
  insert into public.inventory_balances (variant_id, quantity)
  values (ensured_variant.id, 0)
  on conflict (variant_id) do nothing;
  return pg_catalog.jsonb_build_object(
    'id', ensured_variant.id,
    'modelId', ensured_variant.model_id,
    'colorId', ensured_variant.color_id,
    'size', ensured_variant.size,
    'lowStockThreshold', ensured_variant.low_stock_threshold,
    'active', ensured_variant.active
  );
end;
$$;
```

The expression target
`on conflict (model_id, color_id, pg_catalog.lower(size))` infers
`product_variants_model_color_size_label_key`, preserving concurrency safety.

Finish with owner/revoke/grant statements for every replaced function. Revoke
all access to `normalize_size_label(text)` from `public`, `anon`, and
`authenticated`; only trusted RPCs use it internally. Grant the same public RPC
execution surface as migrations 1–4, with the new text ensure signature.

- [ ] **Step 6: Run migration contract tests**

```powershell
npm test -- tests/unit/supabase-migration.test.ts tests/unit/supabase-repository.test.ts
```

Expected: both files pass.

- [ ] **Step 7: Commit**

```powershell
git add -- supabase/migrations/202607230005_text_size_profiles.sql tests/unit/supabase-migration.test.ts tests/unit/supabase-repository.test.ts
git diff --cached --check
git commit -m "feat: migrate Supabase shoe sizes to text"
```

---

### Task 7: Documentation, responsive E2E, full verification, deployment, and push

**Files:**
- Modify: `README.md`
- Modify: `tests/e2e/inventory.spec.ts`

**Interfaces:**
- Consumes: completed string-label application and migration 005.
- Produces: verified desktop/mobile workflow, deployed remote migration, and pushed `master`.

- [ ] **Step 1: Extend E2E expectations**

In the desktop workflow:

1. Confirm Paris options include `M — EU 39–40 · 24–24.5 cm`.
2. Confirm Weave options include `42 — 26–26.5 cm`.
3. Create `E2E Runner / E2E White / FREE`, receive `2` pairs, and assert the
   inventory cell is exactly `FREE`.
4. Create a production order using Paris `M` and custom `FREE`, print it, and
   assert the A4 page includes `M` and `FREE` but not `24–24.5 cm`.
5. Receive the order and assert exact inventory/history changes.

In both mobile projects, confirm the text custom-size input is at least 44 px
high, accepts letters, and causes no horizontal overflow.

- [ ] **Step 2: Update README**

Replace numeric-only instructions with:

```md
ไซซ์มาตรฐานของ Paris/Castor คือ XS–3XL และ Weave คือ 39–45 ช่องเลือกจะแสดงช่วง EU/ความยาวเท้าเพื่อช่วยเลือก แต่ตารางและใบพิมพ์จะแสดงชื่อไซซ์แบบสั้น

เมื่อต้องการไซซ์อื่น ให้เลือก “เพิ่มไซซ์ใหม่” แล้วกรอกข้อความ เช่น FREE, M/L, 39-40 หรือ 2XL ระบบจะปรับตัวอักษรเป็นรูปแบบมาตรฐานและสร้างไซซ์พร้อมรับเข้าสต๊อกในเอกสารเดียว
```

- [ ] **Step 3: Run the complete local verification gate**

Run each command and require exit code `0`:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run e2e -- tests/e2e/inventory.spec.ts
git diff --check
```

Expected:

- all Vitest files pass;
- TypeScript reports no errors;
- ESLint reports no errors;
- Next.js builds every route including production-order print;
- Playwright passes `desktop`, `mobile`, and `mobile-min`;
- Git reports no whitespace errors.

- [ ] **Step 4: Commit documentation and E2E coverage**

```powershell
git add -- README.md tests/e2e/inventory.spec.ts
git diff --cached --check
git commit -m "test: cover model-specific text sizes"
```

Verify `git status --short` shows only the user's pre-existing
`M next-env.d.ts`.

- [ ] **Step 5: Dry-run migration 005**

```powershell
npx supabase migration list
npx supabase db push --dry-run
```

Expected: migrations 1–4 match locally/remotely and only
`202607230005_text_size_profiles.sql` is pending.

If project linkage is missing, stop and ask the user to run:

```powershell
npx supabase login
npx supabase link --project-ref ozbhdorqtktirsexycnp
```

Never expose access tokens or database passwords.

- [ ] **Step 6: Deploy and smoke-test the remote database**

```powershell
npx supabase db push --yes
npx supabase migration list
npx supabase db query --linked "select public.get_inventory_snapshot() is not null as inventory_ready, public.get_production_orders() is not null as production_ready;"
```

Expected: migration 005 applies, all five migration versions match, and both
read-only RPC smoke checks return `true`.

Do not create, receive, issue, exchange, clear, or cancel live data during the
smoke test.

- [ ] **Step 7: Push `master`**

```powershell
git status --short
git push origin master
git rev-parse HEAD
git rev-parse origin/master
```

Expected: push succeeds, both SHAs match, and the only local change remains the
user-owned `next-env.d.ts`.
