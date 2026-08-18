import type {
  ProductionOrder,
  ProductionOrderInput,
  ProductionOrderReceiptInput,
  ProductionOrderReceiptResult,
} from "../domain/types";

export interface ProductionOrderRepository {
  load(): Promise<ProductionOrder[]>;
  subscribe?(listener: () => void): () => void;
  save(input: ProductionOrderInput): Promise<ProductionOrder>;
  cancel(orderId: string): Promise<ProductionOrder>;
  receive(input: ProductionOrderReceiptInput): Promise<ProductionOrderReceiptResult>;
}
