"use client";

import { useRouter } from "next/navigation";
import { ProductionOrderForm } from "@/features/production-orders/components/production-order-form";

export default function NewProductionOrderPage() {
  const router = useRouter();
  return <ProductionOrderForm onSaved={(order) => router.push(`/production-orders/${order.id}`)} />;
}
