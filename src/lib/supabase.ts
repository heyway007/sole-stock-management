import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type ShoeModelRow = {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type ColorRow = {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type ProductVariantRow = {
  id: string;
  model_id: string;
  color_id: string;
  size: string;
  low_stock_threshold: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type InventoryBalanceRow = {
  variant_id: string;
  quantity: number;
  updated_at: string;
};

type StockDocumentRow = {
  id: string;
  client_request_id: string;
  document_number: string;
  movement_type: "RECEIPT" | "SALE" | "DAMAGE" | "ADJUSTMENT" | "EXCHANGE";
  effective_date: string;
  reference: string;
  note: string;
  created_at: string;
};

type StockDocumentLineRow = {
  id: string;
  document_id: string;
  variant_id: string;
  line_number: number;
  delta: number;
  exchange_section: "RETURNED" | "REPLACEMENT" | null;
  note: string | null;
  created_at: string;
};

type TableDefinition<
  Row extends Record<string, unknown>,
  Insert extends Record<string, unknown>,
  Update extends Record<string, unknown>,
> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface InventoryDatabase {
  public: {
    Tables: {
      shoe_models: TableDefinition<
        ShoeModelRow,
        { id?: string; name: string; active?: boolean; created_at?: string; updated_at?: string },
        { name?: string; active?: boolean; updated_at?: string }
      >;
      colors: TableDefinition<
        ColorRow,
        { id?: string; name: string; active?: boolean; created_at?: string; updated_at?: string },
        { name?: string; active?: boolean; updated_at?: string }
      >;
      product_variants: TableDefinition<
        ProductVariantRow,
        {
          id?: string;
          model_id: string;
          color_id: string;
          size: string;
          low_stock_threshold?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        },
        { low_stock_threshold?: number; active?: boolean; updated_at?: string }
      >;
      inventory_balances: TableDefinition<
        InventoryBalanceRow,
        { variant_id: string; quantity?: number; updated_at?: string },
        { quantity?: number; updated_at?: string }
      >;
      stock_documents: TableDefinition<
        StockDocumentRow,
        {
          id?: string;
          client_request_id: string;
          document_number?: string;
          movement_type: StockDocumentRow["movement_type"];
          effective_date: string;
          reference?: string;
          note?: string;
          created_at?: string;
        },
        never
      >;
      stock_document_lines: TableDefinition<
        StockDocumentLineRow,
        {
          id?: string;
          document_id: string;
          variant_id: string;
          line_number: number;
          delta: number;
          exchange_section?: StockDocumentLineRow["exchange_section"];
          note?: string | null;
          created_at?: string;
        },
        never
      >;
    };
    Views: { [_ in never]: never };
    Functions: {
      get_inventory_snapshot: {
        Args: never;
        Returns: Json;
      };
      ensure_product_variant: {
        Args: { p_model_id: string; p_color_id: string; p_size: string };
        Returns: Json;
      };
      post_stock_document: {
        Args: { command: Json };
        Returns: Json;
      };
      clear_inventory_stock: {
        Args: { command: Json };
        Returns: Json;
      };
      get_production_orders: {
        Args: never;
        Returns: Json;
      };
      save_production_order: {
        Args: { command: Json };
        Returns: Json;
      };
      cancel_production_order: {
        Args: { command: Json };
        Returns: Json;
      };
      receive_production_order: {
        Args: { command: Json };
        Returns: Json;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

export type InventorySupabaseClient = SupabaseClient<InventoryDatabase>;

export function createInventorySupabaseClient(url: string, anonymousKey: string): InventorySupabaseClient {
  return createClient<InventoryDatabase>(url, anonymousKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
