"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ProductionOrderForm } from "@/features/production-orders/components/production-order-form";
import { useProductionOrders } from "@/features/production-orders/production-order-provider";

export default function EditProductionOrderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { orders, loading, error, refresh } = useProductionOrders();
  if (loading && !orders) return <div className="page-state" role="status">กำลังโหลดใบผลิต…</div>;
  if (error && !orders) {
    return <div className="page-state page-state--error" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => void refresh()}>ลองใหม่</Button></div>;
  }
  const order = orders?.find((candidate) => candidate.id === params.id);
  if (!order) {
    return <div className="page-state"><div><h1>ไม่พบใบผลิต</h1><Link className="button button--primary" href="/production-orders">กลับหน้ารายการ</Link></div></div>;
  }
  return <ProductionOrderForm order={order} onSaved={(saved) => router.push(`/production-orders/${saved.id}`)} />;
}
