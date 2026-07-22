import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202607220001_inventory.sql"),
  "utf8",
).replaceAll("\r\n", "\n").toLocaleLowerCase("en-US");

describe("Supabase inventory migration ACL", () => {
  it("revokes broad catalog writes before granting only the required columns", () => {
    const broadRevoke = [
      "revoke insert, update, delete on public.shoe_models,",
      "  public.colors, public.product_variants from public, anon, authenticated;",
    ].join("\n");
    const revokeIndex = migration.indexOf(broadRevoke);

    expect(revokeIndex).toBeGreaterThan(-1);
    for (const grant of [
      "grant insert (name), update (name, active) on public.shoe_models to anon, authenticated;",
      "grant insert (name), update (name, active) on public.colors to anon, authenticated;",
      "grant update (low_stock_threshold) on public.product_variants to anon, authenticated;",
    ]) {
      expect(migration.indexOf(grant)).toBeGreaterThan(revokeIndex);
    }
  });

  it("never grants catalog-wide writes or variant identity and activation columns", () => {
    expect(migration).not.toMatch(/grant\s+(?:insert|update|delete)\s+on\s+public\.(?:shoe_models|colors|product_variants)/);
    expect(migration).not.toMatch(/grant\s+(?:insert|update)\s*\([^)]*(?:model_id|color_id|size|active)[^)]*\)\s+on\s+public\.product_variants/);
    expect(migration).not.toMatch(/grant\s+insert\s*\([^)]*\)\s+on\s+public\.product_variants/);
  });
});
