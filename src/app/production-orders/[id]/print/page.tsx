"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ProductionOrderPrint } from "@/features/production-orders/components/production-order-print";
import { useProductionOrders } from "@/features/production-orders/production-order-provider";

export function ProductionOrderPrintPageContent({ orderId }: { orderId?: string } = {}) {
  const params = useParams<{ id: string }>();
  const resolvedOrderId = orderId ?? params.id;
  const { orders, loading, error, refresh } = useProductionOrders();
  if (loading && !orders) return <div className="page-state" role="status">กำลังโหลดใบผลิตสำหรับพิมพ์…</div>;
  if (error && !orders) {
    return <div className="page-state page-state--error" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void refresh()}>ลองใหม่</Button></div>;
  }
  const order = orders?.find((candidate) => candidate.id === resolvedOrderId);
  if (!order) {
    return <div className="page-state"><div><h1>ไม่พบใบผลิตสำหรับพิมพ์</h1><Link className="button button--primary" href="/production-orders">กลับหน้ารายการ</Link></div></div>;
  }
  return <ProductionOrderPrint order={order} />;
}

export default function ProductionOrderPrintPage() {
  return <ProductionOrderPrintPageContent />;
}
