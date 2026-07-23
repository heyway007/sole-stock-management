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
    expect(sizeProfileForModel("paris").map((entry) => entry.label)).toEqual([
      "XS",
      "S",
      "M",
      "L",
      "XL",
      "2XL",
      "3XL",
    ]);
    expect(sizeProfileForModel("Castor")[2]).toEqual({
      label: "M",
      euRange: "39–40",
      footLength: "24–24.5 cm",
    });
    expect(sizeProfileForModel("WEAVE").map((entry) => entry.label)).toEqual([
      "39",
      "40",
      "41",
      "42",
      "43",
      "44",
      "45",
    ]);
    expect(formatSizeOption("Paris", "M")).toBe(
      "M — EU 39–40 · 24–24.5 cm",
    );
    expect(formatSizeOption("Weave", "42")).toBe("42 — 26–26.5 cm");
    expect(formatSizeOption("Runner", "FREE")).toBe("FREE");
  });

  it("orders profile labels first and custom labels naturally afterward", () => {
    expect(
      ["10XL", "FREE", "S", "XS", "2XL"].sort((left, right) =>
        compareSizeLabels("Paris", left, right),
      ),
    ).toEqual(["XS", "S", "2XL", "10XL", "FREE"]);
  });
});
