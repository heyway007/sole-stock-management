import { describe, expect, it } from "vitest";
import {
  mapInventorySnapshot,
  toInventoryRepositoryError,
} from "@/features/inventory/data/supabase-repository";

describe("Supabase inventory mapping", () => {
  it("maps decimal sizes, numeric balances, and signed movement lines", () => {
    const snapshot = mapInventorySnapshot({
      models: [{ id: "model-1", name: "Paris", active: true }],
      colors: [{ id: "color-1", name: "Black", active: true }],
      variants: [{
        id: "variant-1",
        model_id: "model-1",
        color_id: "color-1",
        size: "38.5",
        low_stock_threshold: 3,
        active: true,
      }],
      balances: [{ variant_id: "variant-1", quantity: 7 }],
      documents: [{
        id: "document-1",
        client_request_id: "00000000-0000-4000-8000-000000000001",
        document_number: "STK-20260722-0001",
        movement_type: "EXCHANGE",
        effective_date: "2026-07-22",
        reference: "ORDER-1",
        note: "เปลี่ยนไซซ์",
        created_at: "2026-07-22T10:00:00.000Z",
      }],
      lines: [
        {
          id: "line-1",
          document_id: "document-1",
          variant_id: "variant-1",
          delta: 1,
          exchange_section: "RETURNED",
          note: "รับคืน",
        },
        {
          id: "line-2",
          document_id: "document-1",
          variant_id: "variant-1",
          delta: -1,
          exchange_section: "REPLACEMENT",
          note: null,
        },
      ],
    });

    expect(snapshot.version).toBe(1);
    expect(snapshot.variants[0].size).toBe(38.5);
    expect(snapshot.balances).toEqual({ "variant-1": 7 });
    expect(snapshot.documents[0].lines).toEqual([
      {
        id: "line-1",
        variantId: "variant-1",
        delta: 1,
        section: "RETURNED",
        note: "รับคืน",
      },
      {
        id: "line-2",
        variantId: "variant-1",
        delta: -1,
        section: "REPLACEMENT",
      },
    ]);
  });

  it("translates the PostgreSQL insufficient-stock exception to Thai", () => {
    const error = toInventoryRepositoryError({
      code: "P0001",
      message: "INSUFFICIENT_STOCK",
      details: null,
      hint: null,
    });

    expect(error).toEqual(new Error("สต็อกไม่เพียงพอสำหรับรายการนี้"));
  });
});
