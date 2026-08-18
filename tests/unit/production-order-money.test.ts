import { describe, expect, it } from "vitest";
import {
  amountToMinor,
  discountAmountToMinor,
  parseDiscountInput,
  formatBahtMinor,
  lineTotalMinor,
  parseUnitPriceInput,
} from "@/features/production-orders/domain/money";

describe("production-order money", () => {
  it("parses whole-baht and two-decimal unit prices", () => {
    expect(parseUnitPriceInput("327")).toBe(327);
    expect(parseUnitPriceInput("327.50")).toBe(327.5);
  });

  it.each(["", "0", "-1", "327.555", "1e3"])(
    "rejects invalid price input %s",
    (value) => {
      expect(parseUnitPriceInput(value)).toBeNull();
    },
  );

  it("parses an empty discount as zero and accepts whole or two-decimal baht", () => {
    expect(parseDiscountInput("")).toBe(0);
    expect(parseDiscountInput("0")).toBe(0);
    expect(parseDiscountInput("250")).toBe(250);
    expect(parseDiscountInput("250.50")).toBe(250.5);
  });

  it.each(["-1", "1.234", "1e3"])(
    "rejects invalid discount input %s",
    (value) => {
      expect(parseDiscountInput(value)).toBeNull();
    },
  );

  it("rejects hidden over-precision near the maximum discount", () => {
    expect(discountAmountToMinor(9_999_999_999.99)).toBe(999_999_999_999);
    expect(discountAmountToMinor(9_999_999_999.99001)).toBeNull();
  });

  it("calculates and formats amounts using integer satang", () => {
    expect(amountToMinor(327.5)).toBe(32750);
    expect(lineTotalMinor(10, 327.5)).toBe(327500);
    expect(formatBahtMinor(327500)).toBe("3,275.00 บาท");
  });

  it("returns a dash for an incomplete amount", () => {
    expect(formatBahtMinor(null)).toBe("—");
    expect(lineTotalMinor(10, null)).toBeNull();
  });
});
