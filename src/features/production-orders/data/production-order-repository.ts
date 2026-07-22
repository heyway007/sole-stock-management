import type {
  ProductionOrder,
  ProductionOrderInput,
  ProductionOrderReceiptResult,
} from "../domain/types";

export interface ProductionOrderRepository {
  load(): Promise<ProductionOrder[]>;
  subscribe?(listener: () => void): () => void;
  save(input: ProductionOrderInput): Promise<ProductionOrder>;
  cancel(orderId: string): Promise<ProductionOrder>;
  receive(orderId: string, effectiveDate: string): Promise<ProductionOrderReceiptResult>;
}
