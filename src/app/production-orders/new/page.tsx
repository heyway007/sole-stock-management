"use client";

import { useRouter } from "next/navigation";
import { ProductionOrderForm } from "@/features/production-orders/components/production-order-form";
import { productionOrderDetailHref } from "@/features/production-orders/routes";

export default function NewProductionOrderPage() {
  const router = useRouter();
  return <ProductionOrderForm onSaved={(order) => router.push(productionOrderDetailHref(order.id))} />;
}
