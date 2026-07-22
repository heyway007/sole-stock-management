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

  it("validates an exchange after aggregating reversed lines for the same variant", () => {
    const seed = createSeedSnapshot();
    const variant = seed.variants[0];
    seed.balances[variant.id] = 0;

    const result = postDocument(seed, {
      type: "EXCHANGE",
      effectiveDate: "2026-07-22",
      lines: [
        { variantId: variant.id, size: variant.size, quantity: 1, section: "REPLACEMENT" },
        { variantId: variant.id, size: variant.size, quantity: 1, section: "RETURNED" },
      ],
    }, ids);

    expect(result.balances[variant.id]).toBe(0);
    expect(result.documents.at(-1)?.lines.map((line) => line.delta)).toEqual([-1, 1]);
  });

  it("requires an explicit direction for an adjustment", () => {
    const seed = createSeedSnapshot();
    const variant = seed.variants[0];
    expect(() => postDocument(seed, {
      type: "ADJUSTMENT",
      effectiveDate: "2026-07-22",
      lines: [{ variantId: variant.id, size: variant.size, quantity: 1 }],
    }, ids)).toThrowError("VALIDATION_FAILED");
  });
});
