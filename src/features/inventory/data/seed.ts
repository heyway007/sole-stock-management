import type { InventorySnapshot, ProductVariant } from "@/features/inventory/domain/types";

const sizes = [38, 38.5, 39, 40, 41, 42, 43.5] as const;

const catalog = [
  ["paris", "Paris", "black", "Black"],
  ["paris", "Paris", "navy", "Navy"],
  ["paris", "Paris", "olive", "Olive"],
  ["castor", "Castor", "black", "Black"],
  ["castor", "Castor", "brown", "Brown"],
  ["castor", "Castor", "olive", "Olive"],
  ["weave", "Weave", "black", "Black"],
  ["weave", "Weave", "brown", "Brown"],
  ["weave", "Weave", "sand", "Sand"],
] as const;

function buildVariant(modelId: string, colorId: string, size: number): ProductVariant {
  return {
    id: `${modelId}-${colorId}-${size}`,
    modelId,
    colorId,
    size,
    lowStockThreshold: 3,
    active: true,
  };
}

export function createSeedSnapshot(): InventorySnapshot {
  const models = Array.from(new Map(catalog.map(([modelId, name]) => [modelId, name])).entries()).map(
    ([id, name]) => ({ id, name, active: true }),
  );
  const colors = Array.from(new Map(catalog.map(([, , colorId, name]) => [colorId, name])).entries()).map(
    ([id, name]) => ({ id, name, active: true }),
  );
  const variants = catalog.flatMap(([modelId, , colorId]) =>
    sizes.map((size) => buildVariant(modelId, colorId, size)),
  );
  const balances = Object.fromEntries(
    variants.map((variant, index) => [variant.id, index % 7 === 0 ? 2 : 8 + (index % 13)]),
  );

  return { version: 1, models, colors, variants, balances, documents: [] };
}
