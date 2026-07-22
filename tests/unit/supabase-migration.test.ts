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

  it("ships variant creation and retry reconciliation as a forward migration", () => {
    const upgradeMigration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/202607220002_variant_and_retry_reconciliation.sql"),
      "utf8",
    ).replaceAll("\r\n", "\n").toLocaleLowerCase("en-US");

    expect(migration).not.toContain("create or replace function public.ensure_product_variant(");
    expect(upgradeMigration).toContain("create or replace function public.ensure_product_variant(");
    expect(upgradeMigration).toMatch(/insert into public\.product_variants[\s\S]*?on conflict \(model_id, color_id, size\)[\s\S]*?do update/);
    expect(upgradeMigration).toContain("insert into public.inventory_balances");
    expect(upgradeMigration).toContain("'client_request_id', document.client_request_id");
    expect(upgradeMigration).toContain("alter function public.ensure_product_variant(uuid, uuid, numeric) owner to postgres;");
    expect(upgradeMigration).toContain("revoke all on function public.ensure_product_variant(uuid, uuid, numeric) from public, anon, authenticated;");
    expect(upgradeMigration).toContain("grant execute on function public.ensure_product_variant(uuid, uuid, numeric) to anon, authenticated;");
  });

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
});
