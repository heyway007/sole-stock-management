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

  it("rejects duplicate variants after normalizing surrounding whitespace", () => {
    const result = validateDocument({
      type: "RECEIPT",
      effectiveDate: "2026-07-22",
      lines: [
        { variantId: " paris-black-39 ", size: 39, quantity: 1 },
        { variantId: "paris-black-39", size: 39, quantity: 1 },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "DUPLICATE_VARIANT" })]),
      );
    }
  });

  it("requires each exchange line to declare a valid section", () => {
    const result = validateDocument({
      type: "EXCHANGE",
      effectiveDate: "2026-07-22",
      lines: [{ variantId: "paris-black-39", size: 39, quantity: 1 }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "INVALID_EXCHANGE" })]),
      );
    }
  });

  it("rejects non-ISO dates and non-positive sizes", () => {
    const result = validateDocument({
      type: "SALE",
      effectiveDate: "22-07-2026",
      lines: [{ variantId: "paris-black-39", size: 0, quantity: 1 }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "effectiveDate", code: "REQUIRED" }),
          expect.objectContaining({ path: "lines.0.size", code: "INVALID_SIZE" }),
        ]),
      );
    }
  });

  it("rejects ISO-shaped dates that are not valid calendar dates", () => {
    const result = validateDocument({
      type: "SALE",
      effectiveDate: "2026-99-99",
      lines: [{ variantId: "paris-black-39", size: 39, quantity: 1 }],
    });

    expect(result.success).toBe(false);
  });
});
