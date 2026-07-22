import { describe, expect, it } from "vitest";
import { SupabaseInventoryRepository } from "@/features/inventory/data/supabase-repository";
import type { StockDocument, StockDocumentInput } from "@/features/inventory/domain/types";
import type { InventorySupabaseClient, Json } from "@/lib/supabase";

interface ClientResult {
  data: Json | null;
  error: { code: string; message: string; details: string; hint: string } | null;
}

interface RpcCall {
  name: string;
  args: Record<string, Json> | undefined;
}

interface TableCall {
  table: string;
  operation?: "insert" | "update";
  payload?: Record<string, unknown>;
  select?: string;
  filters: Array<{ column: string; value: unknown }>;
}

interface TableChain {
  insert(payload: Record<string, unknown>): TableChain;
  update(payload: Record<string, unknown>): TableChain;
  select(columns: string): TableChain;
  eq(column: string, value: unknown): TableChain;
  single(): Promise<ClientResult>;
}

class ContractClient {
  readonly rpcCalls: RpcCall[] = [];
  readonly tableCalls: TableCall[] = [];
  readonly rpcResults: ClientResult[] = [];
  readonly singleResults: ClientResult[] = [];
  allowTableCalls = false;

  async rpc(name: string, args?: Record<string, Json>): Promise<ClientResult> {
    this.rpcCalls.push({ name, args });
    const result = this.rpcResults.shift();
    if (!result) throw new Error(`No RPC result configured for ${name}`);
    return result;
  }

  from(table: string): TableChain {
    if (!this.allowTableCalls) throw new Error(`Unexpected direct table query: ${table}`);
    const call: TableCall = { table, filters: [] };
    this.tableCalls.push(call);
    const chain: TableChain = {
      insert: (payload) => {
        call.operation = "insert";
        call.payload = payload;
        return chain;
      },
      update: (payload) => {
        call.operation = "update";
        call.payload = payload;
        return chain;
      },
      select: (columns) => {
        call.select = columns;
        return chain;
      },
      eq: (column, value) => {
        call.filters.push({ column, value });
        return chain;
      },
      single: async () => this.singleResults.shift() ?? {
        data: null,
        error: { code: "PGRST116", message: "No row", details: "", hint: "" },
      },
    };
    return chain;
  }
}

const input: StockDocumentInput = {
  type: "RECEIPT",
  effectiveDate: "2026-07-22",
  reference: "PO-1",
  lines: [{ variantId: "variant-1", size: 38.5, quantity: 2 }],
};

function asClient(client: ContractClient): InventorySupabaseClient {
  return client as unknown as InventorySupabaseClient;
}

function document(id: string, number: string): StockDocument {
  return {
    id,
    number,
    type: "RECEIPT",
    effectiveDate: "2026-07-22",
    reference: "PO-1",
    note: "",
    createdAt: "2026-07-22T10:00:00.000Z",
    lines: [{ id: `${id}-line-1`, variantId: "variant-1", delta: 2 }],
  };
}

describe("SupabaseInventoryRepository client contract", () => {
  it("loads one coherent snapshot RPC payload with multiple documents and ordered lines", async () => {
    const client = new ContractClient();
    client.rpcResults.push({
      data: {
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
        documents: [
          {
            id: "document-1",
            document_number: "STK-20260722-000001",
            movement_type: "RECEIPT",
            effective_date: "2026-07-22",
            reference: "PO-1",
            note: "",
            created_at: "2026-07-22T09:00:00.000Z",
          },
          {
            id: "document-2",
            document_number: "STK-20260722-000002",
            movement_type: "EXCHANGE",
            effective_date: "2026-07-22",
            reference: "EX-1",
            note: "",
            created_at: "2026-07-22T10:00:00.000Z",
          },
        ],
        lines: [
          { id: "line-1", document_id: "document-1", variant_id: "variant-1", delta: 2, exchange_section: null, note: null },
          { id: "line-2", document_id: "document-2", variant_id: "variant-1", delta: 1, exchange_section: "RETURNED", note: null },
          { id: "line-3", document_id: "document-2", variant_id: "variant-1", delta: -1, exchange_section: "REPLACEMENT", note: null },
        ],
      },
      error: null,
    });
    const repository = new SupabaseInventoryRepository("https://example.supabase.co", "anon", asClient(client));

    const snapshot = await repository.load();

    expect(client.rpcCalls).toEqual([{ name: "get_inventory_snapshot", args: undefined }]);
    expect(snapshot.documents).toHaveLength(2);
    expect(snapshot.documents[1].lines.map((line) => line.id)).toEqual(["line-2", "line-3"]);
  });

  it("reuses a request UUID after failure and allocates a new UUID after confirmed success", async () => {
    const client = new ContractClient();
    client.rpcResults.push(
      { data: null, error: { code: "503", message: "network unavailable", details: "", hint: "" } },
      { data: document("document-1", "STK-20260722-000001") as unknown as Json, error: null },
      { data: document("document-2", "STK-20260722-000002") as unknown as Json, error: null },
    );
    const requestIds = [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ];
    const repository = new SupabaseInventoryRepository(
      "https://example.supabase.co",
      "anon",
      asClient(client),
      () => requestIds.shift()!,
    );

    await expect(repository.postDocument(input)).rejects.toThrow(/ไม่สามารถบันทึก/);
    await expect(repository.postDocument(input)).resolves.toMatchObject({ id: "document-1" });
    await expect(repository.postDocument(input)).resolves.toMatchObject({ id: "document-2" });

    const commands = client.rpcCalls.map((call) => call.args?.command as Record<string, Json>);
    expect(client.rpcCalls.map((call) => call.name)).toEqual([
      "post_stock_document",
      "post_stock_document",
      "post_stock_document",
    ]);
    expect(commands.map((command) => command.requestId)).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ]);
  });

  it("uses the open model table contract for a trimmed catalog insert", async () => {
    const client = new ContractClient();
    client.allowTableCalls = true;
    client.singleResults.push({ data: { id: "model-2", name: "Runner", active: true }, error: null });
    const repository = new SupabaseInventoryRepository("https://example.supabase.co", "anon", asClient(client));

    await expect(repository.addModel("  Runner  ")).resolves.toEqual({ id: "model-2", name: "Runner", active: true });
    expect(client.tableCalls).toEqual([{
      table: "shoe_models",
      operation: "insert",
      payload: { name: "Runner" },
      select: "id,name,active",
      filters: [],
    }]);
  });

  it("uses the open color table contract for a trimmed catalog rename", async () => {
    const client = new ContractClient();
    client.allowTableCalls = true;
    client.singleResults.push({ data: { id: "color-1" }, error: null });
    const repository = new SupabaseInventoryRepository("https://example.supabase.co", "anon", asClient(client));

    await repository.renameColor("color-1", "  Midnight  ");
    expect(client.tableCalls).toEqual([{
      table: "colors",
      operation: "update",
      payload: { name: "Midnight" },
      select: "id",
      filters: [{ column: "id", value: "color-1" }],
    }]);
  });
});
