# Retire Legacy Half Sizes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire `38.5` and `43.5` from operational inventory flows without deleting historical references.

**Architecture:** Define the retired-label policy in the size-label domain, enforce it at both repository creation boundaries, and apply a client compatibility overlay to legacy Supabase snapshots. Add a forward-only database migration that deactivates the same labels and prevents reactivation.

**Tech Stack:** Next.js 16, TypeScript 6, Vitest, Supabase PostgreSQL migrations.

## Global Constraints

- Retire exactly `38.5` and `43.5`; do not reject other custom labels.
- Preserve retired variants in snapshots so history can resolve them.
- Do not delete inventory, stock-document, or production-order records.
- Do not alter foot-length text containing decimal centimeters.

---

### Task 1: Retired-size domain policy and snapshot compatibility

**Files:**
- Modify: `tests/unit/size-label.test.ts`
- Modify: `tests/unit/supabase-mapping.test.ts`
- Modify: `src/features/inventory/domain/size-label.ts`
- Modify: `src/features/inventory/data/supabase-repository.ts`

**Interfaces:**
- Produces: `isRetiredSizeLabel(value: unknown): boolean`
- Consumes: `normalizeSizeLabel(value: unknown): string | null`

- [ ] **Step 1: Write failing domain and mapping tests**

```ts
expect(isRetiredSizeLabel("38.5")).toBe(true);
expect(isRetiredSizeLabel("43.5")).toBe(true);
expect(isRetiredSizeLabel("44.5")).toBe(false);
expect(snapshot.variants[0]).toMatchObject({ size: "38.5", active: false });
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- tests/unit/size-label.test.ts tests/unit/supabase-mapping.test.ts`

Expected: FAIL because `isRetiredSizeLabel` does not exist and the mapped
variant remains active.

- [ ] **Step 3: Implement the policy and compatibility overlay**

```ts
const RETIRED_SIZE_LABELS = new Set(["38.5", "43.5"]);

export function isRetiredSizeLabel(value: unknown): boolean {
  const normalized = normalizeSizeLabel(value);
  return normalized !== null && RETIRED_SIZE_LABELS.has(normalized);
}
```

Map Supabase variants with:

```ts
active: variant.active && !isRetiredSizeLabel(variant.size)
```

- [ ] **Step 4: Verify the tests pass**

Run: `npm test -- tests/unit/size-label.test.ts tests/unit/supabase-mapping.test.ts`

Expected: PASS.

### Task 2: Block retired-size creation at repository boundaries

**Files:**
- Modify: `tests/unit/demo-repository.test.ts`
- Modify: `tests/unit/supabase-repository.test.ts`
- Modify: `src/features/inventory/data/demo-repository.ts`
- Modify: `src/features/inventory/data/supabase-repository.ts`

**Interfaces:**
- Consumes: `isRetiredSizeLabel(value: unknown): boolean`
- Preserves: `ensureVariant(modelId: string, colorId: string, size: string): Promise<ProductVariant>`

- [ ] **Step 1: Write failing repository tests**

```ts
await expect(repository.ensureVariant(model.id, color.id, "38.5"))
  .rejects.toThrow("ไซซ์นี้ถูกยกเลิกการใช้งานแล้ว");
await expect(repository.ensureVariant("model-1", "color-1", "43.5"))
  .rejects.toThrow("ไซซ์นี้ถูกยกเลิกการใช้งานแล้ว");
expect(client.rpcCalls).toHaveLength(0);
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm test -- tests/unit/demo-repository.test.ts tests/unit/supabase-repository.test.ts`

Expected: FAIL because both repositories currently create or send retired
labels.

- [ ] **Step 3: Reject retired labels before mutation or RPC**

After normalization in both implementations:

```ts
if (isRetiredSizeLabel(normalizedSize)) {
  throw new Error("ไซซ์นี้ถูกยกเลิกการใช้งานแล้ว");
}
```

- [ ] **Step 4: Verify the tests pass**

Run: `npm test -- tests/unit/demo-repository.test.ts tests/unit/supabase-repository.test.ts`

Expected: PASS.

### Task 3: Forward-only production data retirement

**Files:**
- Create: `supabase/migrations/202607290007_retire_legacy_half_sizes.sql`
- Modify: `tests/unit/supabase-migration.test.ts`

**Interfaces:**
- Consumes: `public.product_variants(size text, active boolean, updated_at timestamptz)`
- Produces: constraint `product_variants_retired_half_sizes_inactive`

- [ ] **Step 1: Write the failing migration contract test**

```ts
expect(retirementMigration).toContain(
  "where size in ('38.5', '43.5')",
);
expect(retirementMigration).toContain(
  "not (active and size in ('38.5', '43.5'))",
);
expect(retirementMigration).not.toMatch(
  /delete\s+from\s+public\.(?:product_variants|inventory_balances|stock_documents|production_orders)/,
);
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test -- tests/unit/supabase-migration.test.ts`

Expected: FAIL because the retirement migration does not exist.

- [ ] **Step 3: Add the migration**

```sql
begin;

update public.product_variants
set active = false,
    updated_at = statement_timestamp()
where size in ('38.5', '43.5');

alter table public.product_variants
  add constraint product_variants_retired_half_sizes_inactive
  check (not (active and size in ('38.5', '43.5')));

commit;
```

- [ ] **Step 4: Verify the migration test passes**

Run: `npm test -- tests/unit/supabase-migration.test.ts`

Expected: PASS.

### Task 4: Release verification and deployment

**Files:**
- Verify all modified files above

- [ ] **Step 1: Run local release checks**

Run in parallel:

```text
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0 with no warnings or failures.

- [ ] **Step 2: Commit and push**

```bash
git add docs src tests supabase
git commit -m "fix: retire legacy half sizes"
git push origin HEAD:main
```

- [ ] **Step 3: Verify Cloudflare and production**

Confirm the Cloudflare build for the pushed commit succeeds. Reload the
deployed inventory and operational selection pages and confirm `38.5` and
`43.5` are absent while `/history` can still resolve historical entries.
