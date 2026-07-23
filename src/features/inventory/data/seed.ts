import type { InventorySnapshot, ProductVariant } from "@/features/inventory/domain/types";
import { sizeProfileForModel } from "@/features/inventory/domain/size-label";

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

function sizeIdPart(size: string): string {
  return encodeURIComponent(size.toLocaleLowerCase("en-US"));
}

function buildVariant(modelId: string, colorId: string, size: string): ProductVariant {
  return {
    id: `${modelId}-${colorId}-${sizeIdPart(size)}`,
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
  const variants = catalog.flatMap(([modelId, modelName, colorId]) =>
    sizeProfileForModel(modelName).map((entry) =>
      buildVariant(modelId, colorId, entry.label),
    ),
  );
  const balances = Object.fromEntries(
    variants.map((variant, index) => [variant.id, index % 7 === 0 ? 2 : 8 + (index % 13)]),
  );

  return { version: 1, revision: 0, models, colors, variants, balances, documents: [] };
}
