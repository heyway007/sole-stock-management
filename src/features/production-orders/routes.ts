export function productionOrderDetailHref(orderId: string): string {
  return `/production-orders/detail?id=${encodeURIComponent(orderId)}`;
}

export function productionOrderEditHref(orderId: string): string {
  return `/production-orders/edit?id=${encodeURIComponent(orderId)}`;
}

export function productionOrderPrintHref(orderId: string): string {
  return `/production-orders/print?id=${encodeURIComponent(orderId)}`;
}
