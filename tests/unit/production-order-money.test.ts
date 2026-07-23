import { describe, expect, it } from "vitest";
import {
  amountToMinor,
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
