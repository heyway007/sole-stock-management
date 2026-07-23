import { describe, expect, it } from "vitest";
import type { InventorySupabaseClient, Json } from "@/lib/supabase";
import {
  PENDING_PRODUCTION_ORDERS_STORAGE_KEY,
  SupabaseProductionOrderRepository,
} from "@/features/production-orders/data/supabase-production-order-repository";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

interface RpcResult {
  data: Json;
  error: null | { code: string; message: string };
}

class ContractClient {
  readonly rpcCalls: Array<{ name: string; args: unknown }> = [];
  readonly rpcResults: RpcResult[] = [];

  async rpc(name: string, args?: unknown) {
    this.rpcCalls.push({ name, args });
    return this.rpcResults.shift() ?? { data: null, error: null };
  }
}

function asClient(client: ContractClient): InventorySupabaseClient {
  return client as unknown as InventorySupabaseClient;
}

const openOrder = {
  id: "order-1",
  number: "PO-20260722-000001",
  orderDate: "2026-07-22",
  expectedDate: "2026-08-05",
  note: "รอบแรก",
  status: "OPEN",
  receivedDocumentId: null,
  createdAt: "2026-07-22T10:00:00.000Z",
  updatedAt: "2026-07-22T10:00:00.000Z",
  receivedAt: null,
  cancelledAt: null,
  lines: [{
    id: "line-1",
    variantId: "variant-1",
    lineNumber: 1,
    modelName: "Paris",
    colorName: "Black",
    size: "M",
    quantity: 4,
  }],
} satisfies Json;

const receiptDocument = {
  id: "document-1",
  number: "STK-20260722-0001",
  type: "RECEIPT",
  effectiveDate: "2026-07-22",
  reference: "PO-20260722-000001",
  note: "รับเข้าจากใบผลิต PO-20260722-000001",
  createdAt: "2026-07-22T10:05:00.000Z",
  lines: [{ id: "document-line-1", variantId: "variant-1", delta: 4 }],
} satisfies Json;

describe("SupabaseProductionOrderRepository", () => {
  it("uses the four RPC contracts and strictly maps orders and receipt documents", async () => {
    const client = new ContractClient();
    const cancelledOrder = {
      ...openOrder,
      status: "CANCELLED",
      cancelledAt: "2026-07-22T10:04:00.000Z",
    } satisfies Json;
    const receivedOrder = {
      ...openOrder,
      status: "RECEIVED",
      receivedDocumentId: "document-1",
      receivedAt: "2026-07-22T10:05:00.000Z",
    } satisfies Json;
    client.rpcResults.push(
      { data: [openOrder], error: null },
      { data: openOrder, error: null },
      { data: cancelledOrder, error: null },
      { data: { order: receivedOrder, document: receiptDocument }, error: null },
    );
    const requestIds = ["request-create", "request-receive"];
    const repository = new SupabaseProductionOrderRepository(
      "https://example.supabase.co",
      "anon",
      asClient(client),
      () => requestIds.shift() ?? "unexpected-request",
      new MemoryStorage(),
    );

    await expect(repository.load()).resolves.toMatchObject([{ number: "PO-20260722-000001" }]);
    await expect(repository.save({
      orderDate: "2026-07-22",
      expectedDate: "2026-08-05",
      note: "รอบแรก",
      lines: [{ variantId: "variant-1", quantity: 4 }],
    })).resolves.toMatchObject({ status: "OPEN" });
    await expect(repository.cancel("order-1")).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(repository.receive("order-1", "2026-07-22")).resolves.toMatchObject({
      order: { status: "RECEIVED" },
      document: { number: "STK-20260722-0001", type: "RECEIPT" },
    });

    expect(client.rpcCalls).toEqual([
      { name: "get_production_orders", args: undefined },
      {
        name: "save_production_order",
        args: { command: expect.objectContaining({ requestId: "request-create", orderDate: "2026-07-22" }) },
      },
      { name: "cancel_production_order", args: { command: { orderId: "order-1" } } },
      {
        name: "receive_production_order",
        args: { command: { requestId: "request-receive", orderId: "order-1", effectiveDate: "2026-07-22" } },
      },
    ]);
  });

  it("persists and reuses a create request ID after a lost response", async () => {
    const client = new ContractClient();
    const storage = new MemoryStorage();
    client.rpcResults.push(
      { data: null, error: { code: "NETWORK", message: "connection lost" } },
      { data: openOrder, error: null },
    );
    const repository = new SupabaseProductionOrderRepository(
      "https://example.supabase.co",
      "anon",
      asClient(client),
      () => "stable-request-id",
      storage,
    );
    const input = {
      orderDate: "2026-07-22",
      expectedDate: "2026-08-05",
      note: "รอบแรก",
      lines: [{ variantId: "variant-1", quantity: 4 }],
    };

    await expect(repository.save(input)).rejects.toThrow("ไม่สามารถบันทึกข้อมูลได้");
    expect([...Array.from({ length: storage.length }, (_, index) => storage.key(index))]
      .filter(Boolean).some((key) => key!.startsWith(`${PENDING_PRODUCTION_ORDERS_STORAGE_KEY}:`))).toBe(true);
    await expect(repository.save(input)).resolves.toMatchObject({ id: "order-1" });
    expect(client.rpcCalls.map((call) => call.args)).toEqual([
      { command: expect.objectContaining({ requestId: "stable-request-id" }) },
      { command: expect.objectContaining({ requestId: "stable-request-id" }) },
    ]);
    expect(storage.length).toBe(0);
  });

  it("rejects malformed nested responses and maps terminal conflicts to Thai", async () => {
    const malformedClient = new ContractClient();
    malformedClient.rpcResults.push({
      data: [{ ...openOrder, lines: [{ ...openOrder.lines[0], quantity: "4" }] }],
      error: null,
    });
    const malformedRepository = new SupabaseProductionOrderRepository(
      "https://example.supabase.co",
      "anon",
      asClient(malformedClient),
    );
    await expect(malformedRepository.load()).rejects.toThrow("ข้อมูลใบผลิตจากเซิร์ฟเวอร์ไม่ถูกต้อง");

    const conflictClient = new ContractClient();
    conflictClient.rpcResults.push({
      data: null,
      error: { code: "P0001", message: "PRODUCTION_ORDER_RECEIVED" },
    });
    const conflictRepository = new SupabaseProductionOrderRepository(
      "https://example.supabase.co",
      "anon",
      asClient(conflictClient),
    );
    await expect(conflictRepository.cancel("order-1")).rejects.toThrow("ใบผลิตนี้รับเข้าสต๊อกแล้ว");
  });

  it("rejects numeric size responses after the text-size migration boundary", async () => {
    const client = new ContractClient();
    client.rpcResults.push({
      data: [{ ...openOrder, lines: [{ ...openOrder.lines[0], size: 38 }] }],
      error: null,
    });
    const repository = new SupabaseProductionOrderRepository(
      "https://example.supabase.co",
      "anon",
      asClient(client),
    );

    await expect(repository.load()).rejects.toThrow(
      "ข้อมูลใบผลิตจากเซิร์ฟเวอร์ไม่ถูกต้อง",
    );
  });
});
