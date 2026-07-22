import { describe, expect, it } from "vitest";
import { PENDING_POSTS_STORAGE_KEY, SupabaseInventoryRepository } from "@/features/inventory/data/supabase-repository";
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

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }

  entries() { return [...this.values.entries()]; }
}

class RecordingLockManager {
  readonly names: string[] = [];

  async request<T>(name: string, callback: () => Promise<T> | T): Promise<T> {
    this.names.push(name);
    return callback();
  }
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

function clearedDocument(): StockDocument {
  return {
    id: "clear-document",
    number: "STK-20260722-000010",
    type: "ADJUSTMENT",
    effectiveDate: "2026-07-22",
    reference: "CLEAR-STOCK",
    note: "ล้างสต๊อกทั้งคลัง",
    createdAt: "2026-07-22T10:00:00.000Z",
    lines: [{ id: "clear-line", variantId: "variant-1", delta: -7 }],
  };
}

function snapshotPayload() {
  return {
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
      client_request_id: "00000000-0000-4000-8000-000000000099",
      document_number: "STK-20260722-000001",
      movement_type: "RECEIPT",
      effective_date: "2026-07-22",
      reference: "PO-1",
      note: "",
      created_at: "2026-07-22T09:00:00.000Z",
    }],
    lines: [{
      id: "line-1",
      document_id: "document-1",
      variant_id: "variant-1",
      delta: 2,
      exchange_section: null as "RETURNED" | "REPLACEMENT" | null,
      note: null,
    }],
  };
}

describe("SupabaseInventoryRepository client contract", () => {
  it("clears stock through the dedicated RPC and maps an audited document or null", async () => {
    const client = new ContractClient();
    client.rpcResults.push(
      { data: clearedDocument() as unknown as Json, error: null },
      { data: null, error: null },
    );
    const requestIds = [
      "00000000-0000-4000-8000-000000000041",
      "00000000-0000-4000-8000-000000000042",
    ];
    const repository = new SupabaseInventoryRepository(
      "https://example.supabase.co",
      "anon",
      asClient(client),
      () => requestIds.shift()!,
    );

    await expect(repository.clearStock("2026-07-22")).resolves.toEqual(clearedDocument());
    await expect(repository.clearStock("2026-07-22")).resolves.toBeNull();
    expect(client.rpcCalls).toEqual([
      {
        name: "clear_inventory_stock",
        args: { command: { requestId: "00000000-0000-4000-8000-000000000041", effectiveDate: "2026-07-22" } },
      },
      {
        name: "clear_inventory_stock",
        args: { command: { requestId: "00000000-0000-4000-8000-000000000042", effectiveDate: "2026-07-22" } },
      },
    ]);
  });

  it("maps a clear-stock RPC failure to the shared Thai save error", async () => {
    const client = new ContractClient();
    client.rpcResults.push({
      data: null,
      error: { code: "503", message: "network unavailable", details: "", hint: "" },
    });
    const repository = new SupabaseInventoryRepository("https://example.supabase.co", "anon", asClient(client));

    await expect(repository.clearStock("2026-07-22"))
      .rejects.toThrow("ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง");
  });

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
            client_request_id: "00000000-0000-4000-8000-000000000098",
            document_number: "STK-20260722-000001",
            movement_type: "RECEIPT",
            effective_date: "2026-07-22",
            reference: "PO-1",
            note: "",
            created_at: "2026-07-22T09:00:00.000Z",
          },
          {
            id: "document-2",
            client_request_id: "00000000-0000-4000-8000-000000000099",
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

  it.each([
    ["movement type", (payload: ReturnType<typeof snapshotPayload>) => { payload.documents[0].movement_type = "UNKNOWN"; }],
    ["variant number", (payload: ReturnType<typeof snapshotPayload>) => { payload.variants[0].size = "not-a-number"; }],
    ["balance number", (payload: ReturnType<typeof snapshotPayload>) => { payload.balances[0].quantity = -1; }],
    ["identifier", (payload: ReturnType<typeof snapshotPayload>) => { payload.models[0].id = ""; }],
    ["client request identifier", (payload: ReturnType<typeof snapshotPayload>) => { payload.documents[0].client_request_id = ""; }],
    ["line delta", (payload: ReturnType<typeof snapshotPayload>) => { payload.lines[0].delta = 0; }],
    ["line reference", (payload: ReturnType<typeof snapshotPayload>) => { payload.lines[0].document_id = "missing-document"; }],
    ["exchange sections", (payload: ReturnType<typeof snapshotPayload>) => {
      payload.documents[0].movement_type = "EXCHANGE";
      payload.lines[0].exchange_section = "RETURNED";
    }],
  ])("rejects a malformed nested snapshot %s before mapping", async (_label, mutate) => {
    const client = new ContractClient();
    const payload = snapshotPayload();
    mutate(payload);
    client.rpcResults.push({ data: payload as unknown as Json, error: null });
    const repository = new SupabaseInventoryRepository("https://example.supabase.co", "anon", asClient(client));

    await expect(repository.load()).rejects.toThrow("ไม่สามารถบันทึกข้อมูลได้");
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

  it("reuses a persisted request UUID after repository reconstruction and clears it on confirmation", async () => {
    const storage = new MemoryStorage();
    const failedClient = new ContractClient();
    failedClient.rpcResults.push({
      data: null,
      error: { code: "503", message: "network unavailable", details: "", hint: "" },
    });
    const first = new SupabaseInventoryRepository(
      "https://example.supabase.co",
      "anon",
      asClient(failedClient),
      () => "00000000-0000-4000-8000-000000000011",
      storage,
    );
    await expect(first.postDocument(input)).rejects.toThrow(/ไม่สามารถบันทึก/);
    expect(storage.getItem(PENDING_POSTS_STORAGE_KEY)).toBeNull();
    expect(storage.entries()).toEqual([
      [expect.stringMatching(new RegExp(`^${PENDING_POSTS_STORAGE_KEY}:`)), "00000000-0000-4000-8000-000000000011"],
    ]);

    const confirmedClient = new ContractClient();
    confirmedClient.rpcResults.push({
      data: document("document-1", "STK-20260722-000001") as unknown as Json,
      error: null,
    });
    const reconstructed = new SupabaseInventoryRepository(
      "https://example.supabase.co",
      "anon",
      asClient(confirmedClient),
      () => "00000000-0000-4000-8000-000000000022",
      storage,
    );

    await expect(reconstructed.postDocument(input)).resolves.toMatchObject({ id: "document-1" });
    const firstCommand = failedClient.rpcCalls[0].args?.command as Record<string, Json>;
    const retriedCommand = confirmedClient.rpcCalls[0].args?.command as Record<string, Json>;
    expect(retriedCommand.requestId).toBe(firstCommand.requestId);
    expect(storage.entries()).toEqual([]);
  });

  it("reconciles a committed request after a lost response before an identical later command", async () => {
    const storage = new MemoryStorage();
    const lockManager = new RecordingLockManager();
    const committedRequestId = "00000000-0000-4000-8000-000000000031";
    const nextRequestId = "00000000-0000-4000-8000-000000000032";
    const failedClient = new ContractClient();
    failedClient.rpcResults.push({
      data: null,
      error: { code: "503", message: "response lost after commit", details: "", hint: "" },
    });
    const first = new SupabaseInventoryRepository(
      "https://example.supabase.co",
      "anon",
      asClient(failedClient),
      () => committedRequestId,
      storage,
      lockManager,
    );

    await expect(first.postDocument(input)).rejects.toThrow();

    const reconciledClient = new ContractClient();
    const committedSnapshot = snapshotPayload();
    committedSnapshot.documents[0].client_request_id = committedRequestId;
    reconciledClient.rpcResults.push(
      { data: committedSnapshot as unknown as Json, error: null },
      { data: document("document-2", "STK-20260722-000002") as unknown as Json, error: null },
    );
    const reconstructed = new SupabaseInventoryRepository(
      "https://example.supabase.co",
      "anon",
      asClient(reconciledClient),
      () => nextRequestId,
      storage,
      lockManager,
    );

    await reconstructed.load();
    expect(storage.entries()).toEqual([]);
    await expect(reconstructed.postDocument(input)).resolves.toMatchObject({ id: "document-2" });

    const laterCommand = reconciledClient.rpcCalls[1].args?.command as Record<string, Json>;
    expect(laterCommand.requestId).toBe(nextRequestId);
    expect(laterCommand.requestId).not.toBe(committedRequestId);
    expect(lockManager.names.length).toBeGreaterThanOrEqual(3);
    expect(new Set(lockManager.names)).toEqual(new Set([PENDING_POSTS_STORAGE_KEY]));
  });

  it("ensures a variant through the concurrency-safe RPC without a direct table insert", async () => {
    const client = new ContractClient();
    client.rpcResults.push({
      data: {
        id: "variant-2",
        modelId: "model-1",
        colorId: "color-1",
        size: 44.5,
        lowStockThreshold: 3,
        active: true,
      },
      error: null,
    });
    const repository = new SupabaseInventoryRepository("https://example.supabase.co", "anon", asClient(client));

    await expect(repository.ensureVariant("model-1", "color-1", 44.5)).resolves.toEqual({
      id: "variant-2",
      modelId: "model-1",
      colorId: "color-1",
      size: 44.5,
      lowStockThreshold: 3,
      active: true,
    });
    expect(client.rpcCalls).toEqual([{
      name: "ensure_product_variant",
      args: { p_model_id: "model-1", p_color_id: "color-1", p_size: 44.5 },
    }]);
    expect(client.tableCalls).toHaveLength(0);
  });

  it.each([
    ["empty identity", { id: "", modelId: "model-1", colorId: "color-1", size: 44.5, lowStockThreshold: 3, active: true }],
    ["empty model", { id: "variant-2", modelId: "", colorId: "color-1", size: 44.5, lowStockThreshold: 3, active: true }],
    ["unsupported precision", { id: "variant-2", modelId: "model-1", colorId: "color-1", size: 44.55, lowStockThreshold: 3, active: true }],
  ])("rejects a malformed ensured variant response with %s", async (_label, payload) => {
    const client = new ContractClient();
    client.rpcResults.push({ data: payload as unknown as Json, error: null });
    const repository = new SupabaseInventoryRepository("https://example.supabase.co", "anon", asClient(client));

    await expect(repository.ensureVariant("model-1", "color-1", 44.5)).rejects.toThrow();
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
