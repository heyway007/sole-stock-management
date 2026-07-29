"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ProductionOrderDetailPageContent } from "../[id]/page";

function RoutedProductionOrderDetailPage() {
  const searchParams = useSearchParams();
  return <ProductionOrderDetailPageContent orderId={searchParams.get("id") ?? undefined} />;
}

export default function ProductionOrderDetailQueryPage() {
  return (
    <Suspense fallback={<div className="page-state" role="status">กำลังโหลดใบผลิต…</div>}>
      <RoutedProductionOrderDetailPage />
    </Suspense>
  );
}
